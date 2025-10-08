import { describe, it } from "mocha"
import "should"
import type { ToolUse } from "@core/assistant-message"
import type { Mode } from "@shared/storage/types"
import { TaskState } from "../../../TaskState"
import { ToolValidator } from "../../ToolValidator"
import type { TaskConfig } from "../../types/TaskConfig"
import { WriteToFileToolHandler } from "../WriteToFileToolHandler"

const createHandler = () => new WriteToFileToolHandler(new ToolValidator({ validateAccess: () => true } as any))

const baseDiffViewProvider = {
	isEditing: false,
	editType: undefined as "modify" | "create" | undefined,
	open: async () => {},
	update: async () => {},
	revertChanges: async () => {},
	reset: async () => {},
	scrollToFirstDiff: async () => {},
	saveChanges: async () => ({
		newProblemsMessage: undefined,
		userEdits: undefined,
		autoFormattingEdits: undefined,
		finalContent: "",
	}),
}

const baseCallbacks = {
	say: async () => undefined,
	ask: async () => ({ response: "" as any }),
	saveCheckpoint: async () => {},
	sayAndCreateMissingParamError: async () => "",
	removeLastPartialMessageIfExistsWithType: async () => {},
	executeCommandTool: async () => [false, ""] as [boolean, any],
	doesLatestTaskCompletionHaveNewChanges: async () => false,
	updateFCListFromToolResponse: async () => {},
	shouldAutoApproveTool: () => false,
	shouldAutoApproveToolWithPath: async () => false,
	postStateToWebview: async () => {},
	reinitExistingTaskFromId: async () => {},
	cancelTask: async () => {},
	updateTaskHistory: async () => [],
	applyLatestBrowserSettings: async () => ({}) as any,
	switchToActMode: async () => false,
}

const createConfig = (overrides: Partial<TaskConfig> = {}): TaskConfig => {
	const taskState = overrides.taskState ?? new TaskState()
	const services = {
		mcpHub: {} as any,
		browserSession: {} as any,
		urlContentFetcher: {} as any,
		diffViewProvider: { ...baseDiffViewProvider },
		fileContextTracker: {
			markFileAsEditedByCline: () => {},
			trackFileContext: async () => {},
			hasSeenFileBeforeEdit: async () => true,
		},
		clineIgnoreController: { validateAccess: () => true },
		contextManager: {} as any,
		stateManager: {} as any,
		...(overrides.services ?? {}),
	} as any

	const config: TaskConfig = {
		taskId: "task",
		ulid: "ulid",
		cwd: ".",
		mode: (overrides.mode ?? ("act" as Mode)) as Mode,
		strictPlanModeEnabled: false,
		yoloModeToggled: false,
		context: {} as any,
		taskState,
		messageState:
			overrides.messageState ??
			({
				getClineMessages: () => [],
				saveClineMessagesAndUpdateHistory: async () => {},
				updateClineMessage: async () => {},
			} as any),
		api:
			overrides.api ??
			({
				getModel: () => ({ id: "test-model" }),
			} as any),
		services,
		autoApprovalSettings: overrides.autoApprovalSettings ?? ({ enabled: false, enableNotifications: false } as any),
		autoApprover: overrides.autoApprover ?? ({} as any),
		browserSettings: overrides.browserSettings ?? ({} as any),
		focusChainSettings: overrides.focusChainSettings ?? ({} as any),
		callbacks: { ...baseCallbacks, ...(overrides.callbacks ?? {}) },
		coordinator: overrides.coordinator ?? ({ getHandler: () => undefined } as any),
	}

	return config
}

describe("WriteToFileToolHandler", () => {
	describe("todo checklist guard", () => {
		it("updates task_progress and skips writing when targeting todo files", async () => {
			const handler = createHandler()
			let capturedProgress: string | undefined
			const config = createConfig({
				callbacks: {
					...baseCallbacks,
					updateFCListFromToolResponse: async (progress?: string) => {
						capturedProgress = progress
					},
				},
			})
			const block = {
				name: "write_to_file",
				params: {
					path: "src/todo.md",
					content: "- [ ] Analyze requirements",
					task_progress: "- [ ] Analyze requirements",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			resultShouldBeString(result)
			capturedProgress?.should.equal("- [ ] Analyze requirements")
			const combined = config.taskState.userMessageContent.map((item: any) => item.text ?? "").join("\n")
			combined.should.containEql("Checklist updated internally")
		})

		it("returns guidance when no task_progress is provided", async () => {
			const handler = createHandler()
			let progressCalled = false
			const config = createConfig({
				callbacks: {
					...baseCallbacks,
					updateFCListFromToolResponse: async () => {
						progressCalled = true
					},
				},
			})
			const block = {
				name: "write_to_file",
				params: {
					path: "todo.md",
					content: "   ",
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			resultShouldBeString(result)
			progressCalled.should.be.false()
			const combined = config.taskState.userMessageContent.map((item: any) => item.text ?? "").join("\n")
			combined.should.containEql("Provide the checklist via <task_progress>")
		})
	})

	describe("plan xml guard", () => {
		it("blocks writing plan output into arbitrary files and updates checklist", async () => {
			const handler = createHandler()
			let capturedProgress: string | undefined
			let updateCalled = false
			let reverted = false
			let resetCalled = false
			const config = createConfig({
				callbacks: {
					...baseCallbacks,
					updateFCListFromToolResponse: async (progress?: string) => {
						capturedProgress = progress
					},
				},
			})

			config.services.diffViewProvider.update = async () => {
				updateCalled = true
			}
			config.services.diffViewProvider.revertChanges = async () => {
				reverted = true
			}
			config.services.diffViewProvider.reset = async () => {
				resetCalled = true
			}

			const block = {
				name: "write_to_file",
				params: {
					path: "src/index.html",
					content: `<task_progress>\n- [ ] Analyze requirements\n- [x] Set up files\n</task_progress>\n<attempt_completion>Done</attempt_completion>`,
				},
			} as unknown as ToolUse

			const result = await handler.execute(config, block)

			resultShouldBeString(result)
			updateCalled.should.be.false()
			reverted.should.be.true()
			resetCalled.should.be.true()
			capturedProgress?.should.equal("- [ ] Analyze requirements\n- [x] Set up files")
			const combined = config.taskState.userMessageContent.map((item: any) => item.text ?? "").join("\n")
			combined.should.containEql("Write operation blocked: plan output")
		})
	})
})

function resultShouldBeString(result: any) {
	;(typeof result).should.equal("string")
}
