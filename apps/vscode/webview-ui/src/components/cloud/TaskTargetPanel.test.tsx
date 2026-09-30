import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TaskTargetPanel } from "./TaskTargetPanel"

const mocks = vi.hoisted(() => ({
	cloudTaskTarget: { target: "cloud" } as {
		target: "local" | "cloud"
		repoUrl?: string
		repositoryId?: number
		branch?: string
		workspaceRepoUrl?: string
	},
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
	getRepositoryBranches: vi.fn(),
	chooseCloudTaskTarget: vi.fn(),
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({ cloudTaskTarget: mocks.cloudTaskTarget }),
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
		chooseCloudTaskTarget: mocks.chooseCloudTaskTarget,
	},
}))

const clineRepo = { id: 7, name: "cline", fullName: "cline/cline", url: "https://github.com/cline/cline", defaultBranch: "main" }

describe("TaskTargetPanel", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.cloudTaskTarget = { target: "cloud" }
		mocks.clineUser = undefined
		mocks.connection = undefined
		mocks.getRepositoryBranches.mockResolvedValue({ branches: [] })
		mocks.chooseCloudTaskTarget.mockResolvedValue({})
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

	it("shows the repository and branch the extension resolved and loads that repository's branches", async () => {
		mocks.clineUser = { uid: "user-1" }
		mocks.connection = { signedIn: true, connected: true, connectUrl: "", repositories: [clineRepo] }
		mocks.cloudTaskTarget = { target: "cloud", repositoryId: 7, repoUrl: clineRepo.url, branch: "feature/cloud" }
		mocks.getRepositoryBranches.mockResolvedValue({ branches: ["main", "develop"] })

		render(<TaskTargetPanel />)

		expect(await screen.findByText("cline/cline")).toBeInTheDocument()
		expect(screen.getByText("feature/cloud")).toBeInTheDocument()
		expect(mocks.getRepositoryBranches).toHaveBeenCalledWith(expect.objectContaining({ repositoryId: 7 }))
		expect(mocks.chooseCloudTaskTarget).not.toHaveBeenCalled()
	})

	it("sends Local as one choice and nothing else, even while GitHub is still answering", async () => {
		mocks.clineUser = { uid: "user-1" }
		mocks.connection = { signedIn: true, connected: true, connectUrl: "", repositories: [clineRepo] }
		mocks.cloudTaskTarget = { target: "cloud", repositoryId: 7, repoUrl: clineRepo.url, branch: "main" }
		mocks.getRepositoryBranches.mockReturnValue(new Promise(() => {}))

		render(<TaskTargetPanel />)
		await userEvent.click(screen.getByRole("radio", { name: "Local" }))

		expect(mocks.chooseCloudTaskTarget).toHaveBeenCalledTimes(1)
		expect(mocks.chooseCloudTaskTarget).toHaveBeenCalledWith(expect.objectContaining({ target: "local" }))
	})

	it("warns when the workspace's repository is not accessible to the GitHub App", async () => {
		mocks.clineUser = { uid: "user-1" }
		mocks.connection = { signedIn: true, connected: true, connectUrl: "", repositories: [clineRepo] }
		mocks.cloudTaskTarget = {
			target: "cloud",
			repositoryId: 7,
			repoUrl: clineRepo.url,
			workspaceRepoUrl: "https://github.com/other/private",
		}

		render(<TaskTargetPanel />)

		expect(await screen.findByText(/other\/private/)).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Manage access" })).toBeInTheDocument()
	})
})
