import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Controller } from "@/core/controller"
import type { ApiConfiguration } from "@/shared/api"
import { generateCommitMsg } from "./commit-message-generator"

const mocks = vi.hoisted(() => ({
	buildApiHandler: vi.fn(),
	getGitDiff: vi.fn(),
	getExtension: vi.fn(),
	showMessage: vi.fn(),
}))

vi.mock("@/core/controller", () => ({ Controller: class {} }))
vi.mock("@/sdk/sdk-api-handler", () => ({ buildApiHandler: mocks.buildApiHandler }))
vi.mock("@/utils/git", () => ({ getGitDiff: mocks.getGitDiff }))
vi.mock("@/hosts/host-provider", () => ({ HostProvider: { window: { showMessage: mocks.showMessage } } }))
vi.mock("vscode", () => ({
	extensions: { getExtension: mocks.getExtension },
	commands: { executeCommand: vi.fn() },
	ProgressLocation: { SourceControl: 1 },
	window: { withProgress: async (_options: unknown, task: () => Promise<void>) => task() },
}))

describe("generateCommitMsg", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it.each(["xhigh", undefined] as const)("preserves Act-mode reasoning configuration (%s)", async (reasoningEffort) => {
		const configuration: ApiConfiguration = {
			actModeApiProvider: "openai",
			actModeOpenAiModelId: "reasoning-model",
			actModeReasoningEffort: reasoningEffort,
			planModeReasoningEffort: "low",
		}
		const controller = {
			stateManager: { getApiConfiguration: () => configuration },
		} as unknown as Controller
		const repository = { rootUri: { fsPath: "/repo" }, inputBox: { value: "" } }
		mocks.getExtension.mockReturnValue({ exports: { getAPI: () => ({ repositories: [repository] }) } })
		mocks.getGitDiff.mockResolvedValue("staged diff content")
		mocks.buildApiHandler.mockReturnValue({
			createMessage: async function* () {
				yield { type: "text", text: "Fix commit message generation" }
			},
		})

		await generateCommitMsg(controller)

		expect(mocks.showMessage).not.toHaveBeenCalled()
		expect(mocks.buildApiHandler).toHaveBeenCalledExactlyOnceWith(configuration, "act")
		expect(repository.inputBox.value).toBe("Fix commit message generation")
	})
})
