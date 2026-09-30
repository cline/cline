import { afterEach, describe, expect, it, vi } from "vitest"
import { type CloudRepository, CloudSessionError } from "@/services/cloud/CloudSessionsService"
import {
	LOOKUP_RETRY_MS,
	REPOSITORIES_MAX_AGE_MS,
	SdkCloudTaskTarget,
	type SdkCloudTaskTargetOptions,
	WORKSPACE_MAX_AGE_MS,
} from "./sdk-cloud-task-target"

const mocks = vi.hoisted(() => ({
	workspaceDefaults: vi.fn<(cwd: string) => Promise<{ repoUrl?: string; branch?: string }>>(async () => ({})),
}))
vi.mock("@/services/cloud/workspace-cloud-defaults", () => ({
	resolveWorkspaceCloudDefaults: (cwd: string) => mocks.workspaceDefaults(cwd),
}))

afterEach(() => {
	vi.restoreAllMocks()
	mocks.workspaceDefaults.mockReset()
	mocks.workspaceDefaults.mockResolvedValue({})
})

const cline: CloudRepository = {
	id: 7,
	name: "cline",
	fullName: "cline/cline",
	url: "https://github.com/cline/cline",
	defaultBranch: "main",
}
const other: CloudRepository = {
	id: 9,
	name: "other",
	fullName: "acme/other",
	url: "https://github.com/acme/other",
	defaultBranch: "trunk",
}

/** In-memory global state; share one between targets to model one install seen by two accounts. */
function makeStateManager(globalState: Record<string, unknown> = {}) {
	return {
		getGlobalStateKey: (key: string) => globalState[key],
		setGlobalState: (key: string, value: unknown) => {
			globalState[key] = value
		},
	} as never
}

function makeTarget(overrides: Partial<SdkCloudTaskTargetOptions> = {}) {
	const globalState: Record<string, unknown> = {}
	const cloudSessions = {
		getGitHubConnection: vi.fn(async () => ({ connected: true, connectUrl: "", repositories: [cline, other] })),
		listBranches: vi.fn(async (_repositoryId: number, query?: string) => (query ? [query] : ["main"])),
		githubConnectUrl: () => "https://app.test/connect",
	}
	let now = 1_000_000
	const options: SdkCloudTaskTargetOptions = {
		cloudSessions: cloudSessions as never,
		stateManager: makeStateManager(globalState),
		getAccountScope: () => "user-1:",
		getWorkspaceRoot: () => "/workspace",
		postStateToWebview: vi.fn(async () => undefined),
		now: () => now,
		...overrides,
	}
	return { target: new SdkCloudTaskTarget(options), cloudSessions, options, globalState, advance: (ms: number) => (now += ms) }
}

/** Waits for the background lookups a view() started to land. */
async function settle() {
	for (let i = 0; i < 10; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0))
	}
}

describe("SdkCloudTaskTarget", () => {
	it("stores only the user's choice and resolves the rest on read", async () => {
		const { target, globalState } = makeTarget()
		mocks.workspaceDefaults.mockResolvedValue({ repoUrl: "https://github.com/cline/cline", branch: "feature/x" })

		await target.choose({ target: "cloud" })
		expect(globalState.cloudTaskTarget).toEqual({ target: "cloud" })

		// The first read starts the lookups; nothing is written. The branch
		// check needs the repository list, so it starts on the read after that
		// lands (each state post converges one step).
		expect(target.view()).toEqual({ target: "cloud" })
		await settle()
		expect(target.view()).toMatchObject({ repositoryId: 7, branch: "main" })
		await settle()
		expect(globalState.cloudTaskTarget).toEqual({ target: "cloud" })
		expect(target.view()).toEqual({
			target: "cloud",
			repositoryId: 7,
			repoUrl: "https://github.com/cline/cline",
			branch: "feature/x",
			workspaceRepoUrl: "https://github.com/cline/cline",
		})
	})

	it("keeps Local when a lookup lands after the user chose it", async () => {
		const { target, cloudSessions, options } = makeTarget()
		let release!: () => void
		cloudSessions.getGitHubConnection.mockReturnValue(
			new Promise((resolve) => {
				release = () => resolve({ connected: true, connectUrl: "", repositories: [cline] })
			}),
		)
		await target.choose({ target: "cloud" })
		target.view()
		await target.choose({ target: "local" })
		release()
		await settle()

		expect(target.view()).toEqual({ target: "local" })
		// The landed lookup posted state, and that state carries Local.
		expect(options.postStateToWebview).toHaveBeenCalled()
	})

	it("does not select a repository another account chose, nor carry its branch over", async () => {
		const globalState: Record<string, unknown> = {}
		const first = makeTarget({ stateManager: makeStateManager(globalState) })
		await first.target.choose({ repositoryId: other.id })
		await first.target.choose({ branch: "release" })
		first.target.view()
		await settle()
		expect(first.target.view()).toMatchObject({ repositoryId: other.id, branch: "release" })

		// Same install, another account: only cline/cline is reachable.
		const second = makeTarget({ stateManager: makeStateManager(globalState), getAccountScope: () => "user-2:" })
		second.cloudSessions.getGitHubConnection.mockResolvedValue({ connected: true, connectUrl: "", repositories: [cline] })
		second.target.view()
		await settle()

		expect(second.target.view()).toMatchObject({ repositoryId: cline.id, branch: "main" })
		expect(globalState.cloudTaskTarget).toEqual({ target: "cloud", repositoryId: other.id, branch: "release" })
	})

	it("suggests the workspace branch only once GitHub confirms it, and retries a failed check later", async () => {
		const { target, cloudSessions, advance } = makeTarget()
		mocks.workspaceDefaults.mockResolvedValue({ repoUrl: "https://github.com/cline/cline", branch: "feature/gone" })
		cloudSessions.listBranches.mockRejectedValueOnce(new Error("offline"))
		await target.choose({ target: "cloud" })
		target.view()
		await settle()
		expect(target.view().branch).toBe("main")
		expect(cloudSessions.listBranches).toHaveBeenCalledTimes(1)

		// Too soon: the failed check is left alone.
		target.view()
		await settle()
		expect(cloudSessions.listBranches).toHaveBeenCalledTimes(1)

		advance(LOOKUP_RETRY_MS)
		cloudSessions.listBranches.mockResolvedValueOnce([])
		target.view()
		await settle()
		expect(cloudSessions.listBranches).toHaveBeenCalledTimes(2)
		expect(cloudSessions.listBranches).toHaveBeenLastCalledWith(7, "feature/gone")
		// GitHub no longer has it, whatever the local remote-tracking ref says.
		expect(target.view().branch).toBe("main")
	})

	it("attaches a chosen branch to the repository the view resolved", async () => {
		const { target } = makeTarget()
		mocks.workspaceDefaults.mockResolvedValue({ repoUrl: "https://github.com/acme/other" })
		await target.choose({ target: "cloud" })
		target.view()
		await settle()
		expect(target.view()).toMatchObject({ repositoryId: other.id, branch: "trunk" })

		await target.choose({ branch: "hotfix" })

		expect(target.view()).toMatchObject({ repositoryId: other.id, branch: "hotfix" })
	})

	it("reports the connection per account and refreshes on request", async () => {
		const { target, cloudSessions } = makeTarget()
		expect(await target.connectionStatus()).toMatchObject({ signedIn: true, connected: true })
		await target.connectionStatus()
		expect(cloudSessions.getGitHubConnection).toHaveBeenCalledTimes(1)
		await target.connectionStatus(true)
		expect(cloudSessions.getGitHubConnection).toHaveBeenCalledTimes(2)

		cloudSessions.getGitHubConnection.mockRejectedValueOnce(new CloudSessionError("authentication_required", "expired"))
		expect(await target.connectionStatus(true)).toMatchObject({ signedIn: false, connectUrl: "https://app.test/connect" })
	})

	it("re-reads repositories and the workspace checkout once they age, keeping the old answer meanwhile", async () => {
		const { target, cloudSessions, advance } = makeTarget()
		mocks.workspaceDefaults.mockResolvedValue({ repoUrl: "https://github.com/cline/cline", branch: "feature/a" })
		await target.choose({ target: "cloud" })
		target.view()
		await settle()
		target.view()
		await settle()
		expect(target.view()).toMatchObject({ repositoryId: 7, branch: "feature/a" })
		expect(cloudSessions.getGitHubConnection).toHaveBeenCalledTimes(1)
		expect(mocks.workspaceDefaults).toHaveBeenCalledTimes(1)

		// The user checks out another branch in the terminal and revokes the
		// GitHub App's access to the repository in the browser.
		mocks.workspaceDefaults.mockResolvedValue({ repoUrl: "https://github.com/cline/cline", branch: "feature/b" })
		cloudSessions.getGitHubConnection.mockResolvedValue({ connected: true, connectUrl: "", repositories: [other] })

		advance(WORKSPACE_MAX_AGE_MS)
		// The aged read still answers from cache and reloads behind it.
		expect(target.view()).toMatchObject({ repositoryId: 7, branch: "feature/a" })
		await settle()
		target.view()
		await settle()
		expect(target.view()).toMatchObject({ repositoryId: 7, branch: "feature/b" })
		expect(cloudSessions.getGitHubConnection).toHaveBeenCalledTimes(1)

		advance(REPOSITORIES_MAX_AGE_MS)
		target.view()
		await settle()
		expect(cloudSessions.getGitHubConnection).toHaveBeenCalledTimes(2)
		expect(target.view()).toMatchObject({ repositoryId: other.id, branch: "trunk" })
	})

	it("is Local with no lookups when the user has not chosen Cloud", async () => {
		const { target, cloudSessions } = makeTarget()
		expect(target.view()).toEqual({ target: "local" })
		await settle()
		expect(cloudSessions.getGitHubConnection).not.toHaveBeenCalled()
		expect(mocks.workspaceDefaults).not.toHaveBeenCalled()
	})
})
