import { render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TaskTargetPanel } from "./TaskTargetPanel"

const mocks = vi.hoisted(() => ({
	cloudTaskTarget: { target: "cloud" as const },
	clineUser: undefined as { uid: string } | undefined,
	connection: undefined as
		| {
				signedIn: boolean
				connected: boolean
				connectUrl: string
				repositories: Array<{ id: number; name: string; fullName: string; url: string; defaultBranch: string }>
				error?: string
		  }
		| undefined,
	getWorkspaceCloudDefaults: vi.fn(),
	getRepositoryBranches: vi.fn(),
	setCloudTaskTarget: vi.fn(),
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		cloudTaskTarget: mocks.cloudTaskTarget,
		workspaceRoots: ["/workspace"],
		primaryRootIndex: 0,
	}),
}))

vi.mock("@/context/ClineAuthContext", () => ({
	useClineAuth: () => ({ clineUser: mocks.clineUser }),
	useClineSignIn: () => ({ handleSignIn: vi.fn() }),
}))

vi.mock("@/hooks/useGitHubConnection", () => ({
	useGitHubConnection: () => ({ connection: mocks.connection, loading: false, refresh: vi.fn() }),
}))

vi.mock("@/services/grpc-client", () => ({
	CloudServiceClient: {
		connectGitHub: vi.fn(),
		getRepositoryBranches: mocks.getRepositoryBranches,
		getWorkspaceCloudDefaults: mocks.getWorkspaceCloudDefaults,
		setCloudTaskTarget: mocks.setCloudTaskTarget,
	},
}))

describe("TaskTargetPanel", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.cloudTaskTarget = { target: "cloud" }
		mocks.clineUser = undefined
		mocks.connection = undefined
		mocks.getWorkspaceCloudDefaults.mockResolvedValue({})
		mocks.getRepositoryBranches.mockResolvedValue({ branches: [] })
		mocks.setCloudTaskTarget.mockResolvedValue({})
	})

	it("shows sign-in onboarding when Cloud is selected while signed out", async () => {
		render(<TaskTargetPanel />)

		expect(await screen.findByText("Run Cline in the cloud")).toBeInTheDocument()
		expect(screen.getByRole("button", { name: /Sign in to Cline/i })).toBeInTheDocument()
	})

	it("shows repository onboarding when GitHub has no accessible repositories", async () => {
		mocks.clineUser = { uid: "user-1" }
		mocks.connection = { signedIn: true, connected: true, connectUrl: "", repositories: [] }

		render(<TaskTargetPanel />)

		expect(await screen.findByText("Give Cline access to a repository")).toBeInTheDocument()
		expect(screen.getByRole("button", { name: /Manage repository access/i })).toBeInTheDocument()
	})

	it("clears a stored repository the current account cannot access", async () => {
		// The target was chosen under another account; this one has no repositories,
		// so the panel shows onboarding. The stored URL must not keep the composer's
		// submit enabled against a repository the user has not selected here.
		mocks.clineUser = { uid: "user-2" }
		mocks.cloudTaskTarget = {
			target: "cloud",
			repoUrl: "https://github.com/other/repo",
			repositoryId: 9,
			branch: "main",
		} as never
		mocks.connection = { signedIn: true, connected: true, connectUrl: "", repositories: [] }

		render(<TaskTargetPanel />)

		await waitFor(() => {
			expect(mocks.setCloudTaskTarget).toHaveBeenCalledWith(
				expect.objectContaining({ target: "cloud", repoUrl: undefined, repositoryId: undefined, branch: undefined }),
			)
		})
	})

	it("suggests the workspace branch only when GitHub still has it", async () => {
		mocks.clineUser = { uid: "user-1" }
		mocks.connection = {
			signedIn: true,
			connected: true,
			connectUrl: "",
			repositories: [
				{ id: 7, name: "cline", fullName: "cline/cline", url: "https://github.com/cline/cline", defaultBranch: "main" },
			],
		}
		mocks.getWorkspaceCloudDefaults.mockResolvedValue({
			repoUrl: "git@github.com:cline/cline.git",
			branch: "feature/deleted-on-github",
		})
		// GitHub no longer has the branch, whatever the local remote-tracking ref says.
		mocks.getRepositoryBranches.mockImplementation(async ({ query }: { query?: string }) => ({
			branches: query ? [] : ["main", "develop"],
		}))

		const { rerender } = render(<TaskTargetPanel />)

		await waitFor(() => {
			expect(mocks.setCloudTaskTarget).toHaveBeenCalledWith(
				expect.objectContaining({ target: "cloud", repositoryId: 7, branch: "main" }),
			)
		})
		mocks.cloudTaskTarget = {
			target: "cloud",
			repositoryId: 7,
			repoUrl: "https://github.com/cline/cline",
			branch: "main",
		} as never
		rerender(<TaskTargetPanel />)
		await waitFor(() => {
			expect(mocks.getRepositoryBranches).toHaveBeenCalledWith(
				expect.objectContaining({ repositoryId: 7, query: "feature/deleted-on-github" }),
			)
		})

		expect(mocks.setCloudTaskTarget).not.toHaveBeenCalledWith(
			expect.objectContaining({ branch: "feature/deleted-on-github" }),
		)
	})

	it("prefills the matching repository and branch from workspace defaults", async () => {
		mocks.clineUser = { uid: "user-1" }
		mocks.connection = {
			signedIn: true,
			connected: true,
			connectUrl: "",
			repositories: [
				{
					id: 7,
					name: "cline",
					fullName: "cline/cline",
					url: "https://github.com/cline/cline",
					defaultBranch: "main",
				},
			],
		}
		mocks.getWorkspaceCloudDefaults.mockResolvedValue({
			repoUrl: "git@github.com:cline/cline.git",
			branch: "feature/cloud",
		})
		// The branch is beyond the first page of the unfiltered list; only the
		// targeted query finds it.
		mocks.getRepositoryBranches.mockImplementation(async ({ query }: { query?: string }) => ({
			branches: query === "feature/cloud" ? ["feature/cloud"] : ["main", "develop"],
		}))

		const { rerender } = render(<TaskTargetPanel />)

		await waitFor(() => {
			expect(mocks.setCloudTaskTarget).toHaveBeenCalledWith(
				expect.objectContaining({ target: "cloud", repositoryId: 7, repoUrl: "https://github.com/cline/cline" }),
			)
		})
		// The extension echoes the persisted selection back through state.
		mocks.cloudTaskTarget = {
			target: "cloud",
			repositoryId: 7,
			repoUrl: "https://github.com/cline/cline",
			branch: "main",
		} as never
		rerender(<TaskTargetPanel />)

		await waitFor(() => {
			expect(mocks.setCloudTaskTarget).toHaveBeenCalledWith(
				expect.objectContaining({ target: "cloud", repositoryId: 7, branch: "feature/cloud" }),
			)
		})
	})
})
