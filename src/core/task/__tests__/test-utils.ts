import { ClineDefaultTool } from "@shared/tools"
import sinon from "sinon"
import * as vscode from "vscode"
import { ToolUse } from "../../assistant-message"
import { Task } from "../index"
import { TaskState } from "../TaskState"
import { ToolExecutor } from "../ToolExecutor"

/**
 * Creates a minimal mock Task instance for testing
 */
export function createMockTask(options: any = {}): Task {
	const taskState = new TaskState()
	const messageStateHandler = {
		getClineMessages: sinon.stub().returns([]),
		setClineMessages: sinon.stub(),
		addToClineMessages: sinon.stub().resolves(),
		updateClineMessage: sinon.stub().resolves(),
		saveClineMessagesAndUpdateHistory: sinon.stub().resolves(),
		getApiConversationHistory: sinon.stub().returns([]),
		setApiConversationHistory: sinon.stub(),
		addToApiConversationHistory: sinon.stub().resolves(),
		overwriteApiConversationHistory: sinon.stub().resolves(),
		overwriteClineMessages: sinon.stub().resolves(),
	} as any

	const mockController = {
		context: { globalState: { get: sinon.stub(), update: sinon.stub() } } as any,
		mcpHub: {
			isConnecting: false,
			setNotificationCallback: sinon.stub(),
			clearNotificationCallback: sinon.stub(),
		} as any,
		updateTaskHistory: sinon.stub().resolves([]),
		postStateToWebview: sinon.stub().resolves(),
		reinitExistingTaskFromId: sinon.stub().resolves(),
		cancelTask: sinon.stub().resolves(),
		shouldShowBackgroundTerminalSuggestion: sinon.stub().returns(false),
		updateBackgroundCommandState: sinon.stub(),
		toggleActModeForYoloMode: sinon.stub().resolves(false),
	}

	const mockStateManager = {
		getGlobalSettingsKey: sinon.stub().callsFake((key: string) => {
			const defaults: any = {
				mode: "act",
				hooksEnabled: options.hooksEnabled || false,
				enableCheckpointsSetting: false,
				strictPlanModeEnabled: false,
				yoloModeToggled: false,
				maxConsecutiveMistakes: 3,
				autoApprovalSettings: {},
				browserSettings: {},
				focusChainSettings: { enabled: false },
			}
			return defaults[key]
		}),
		getApiConfiguration: sinon.stub().returns({
			apiProvider: "anthropic",
			apiModelId: "claude-4-sonnet-20250514",
		}),
		getGlobalStateKey: sinon.stub().returns(true),
	} as any

	const params: any = {
		controller: mockController,
		mcpHub: mockController.mcpHub,
		updateTaskHistory: mockController.updateTaskHistory,
		postStateToWebview: mockController.postStateToWebview,
		reinitExistingTaskFromId: mockController.reinitExistingTaskFromId,
		cancelTask: mockController.cancelTask,
		shellIntegrationTimeout: 5000,
		terminalReuseEnabled: true,
		terminalOutputLineLimit: 500,
		subagentTerminalOutputLineLimit: 2000,
		defaultTerminalProfile: "bash",
		vscodeTerminalExecutionMode: "vscodeTerminal",
		cwd: "/test/workspace",
		stateManager: mockStateManager,
		workspaceManager: undefined,
		task: "Test task",
		images: [],
		files: [],
		historyItem: undefined,
		taskId: "test-task-id",
		taskLockAcquired: false,
	}

	// Create a partial Task instance for testing
	const task = Object.create(Task.prototype)
	task.taskId = params.taskId
	task.ulid = "test-ulid"
	task.taskState = taskState
	task.messageStateHandler = messageStateHandler
	// Make stateManager accessible for testing
	Object.defineProperty(task, "stateManager", {
		get: () => mockStateManager,
		configurable: true,
	})
	task.controller = mockController

	// Add the say method that we're testing
	task.say = async function (
		type: any,
		text?: string,
		images?: string[],
		files?: string[],
		partial?: boolean,
	): Promise<number | undefined> {
		if (partial !== undefined) {
			const lastMessage = messageStateHandler.getClineMessages().at(-1)
			const isUpdatingPreviousPartial =
				lastMessage && lastMessage.partial && lastMessage.type === "say" && lastMessage.say === type

			if (partial) {
				if (isUpdatingPreviousPartial) {
					lastMessage.text = text
					lastMessage.images = images
					lastMessage.files = files
					lastMessage.partial = partial
					return undefined
				} else {
					const sayTs = Date.now()
					this.taskState.lastMessageTs = sayTs
					await messageStateHandler.addToClineMessages({
						ts: sayTs,
						type: "say",
						say: type,
						text,
						images,
						files,
						partial,
					})
					return sayTs
				}
			} else {
				if (isUpdatingPreviousPartial) {
					this.taskState.lastMessageTs = lastMessage.ts
					lastMessage.text = text
					lastMessage.images = images
					lastMessage.files = files
					lastMessage.partial = false
					await messageStateHandler.saveClineMessagesAndUpdateHistory()
					return lastMessage.ts // Return the timestamp
				} else {
					const sayTs = Date.now()
					this.taskState.lastMessageTs = sayTs
					await messageStateHandler.addToClineMessages({
						ts: sayTs,
						type: "say",
						say: type,
						text,
						images,
						files,
					})
					return sayTs
				}
			}
		} else {
			const sayTs = Date.now()
			this.taskState.lastMessageTs = sayTs
			await messageStateHandler.addToClineMessages({
				ts: sayTs,
				type: "say",
				say: type,
				text,
				images,
				files,
			})
			return sayTs
		}
	}

	return task
}

/**
 * Creates a minimal mock TaskConfig for handler testing
 */
export function createMockTaskConfig(options: any = {}): any {
	const taskState = new TaskState()

	return {
		taskId: "test-task-id",
		ulid: "test-ulid",
		context: {} as vscode.ExtensionContext,
		mode: options.mode || "act",
		strictPlanModeEnabled: false,
		yoloModeToggled: false,
		vscodeTerminalExecutionMode: "vscodeTerminal",
		cwd: "/test/workspace",
		workspaceManager: undefined,
		isMultiRootEnabled: false,
		taskState,
		messageState: {
			getClineMessages: sinon.stub().returns([]),
			addToClineMessages: sinon.stub().resolves(),
		} as any,
		api: {
			getModel: sinon.stub().returns({ id: "claude-4-sonnet-20250514", info: {} }),
		} as any,
		autoApprovalSettings: {},
		autoApprover: {
			shouldAutoApproveTool: sinon.stub().returns(false),
			shouldAutoApproveToolWithPath: sinon.stub().resolves(false),
		} as any,
		browserSettings: {},
		focusChainSettings: { enabled: false },
		services: {
			mcpHub: {} as any,
			browserSession: {} as any,
			urlContentFetcher: {} as any,
			diffViewProvider: {
				isEditing: false,
				reset: sinon.stub().resolves(),
				revertChanges: sinon.stub().resolves(),
			} as any,
			fileContextTracker: {} as any,
			clineIgnoreController: {} as any,
			contextManager: {} as any,
			stateManager: {} as any,
		},
		callbacks: {
			say: sinon.stub().resolves(Date.now()),
			ask: sinon.stub().resolves({ response: "yesButtonClicked" }),
			saveCheckpoint: sinon.stub().resolves(),
			postStateToWebview: sinon.stub().resolves(),
			reinitExistingTaskFromId: sinon.stub().resolves(),
			cancelTask: sinon.stub().resolves(),
			updateTaskHistory: sinon.stub().resolves([]),
			executeCommandTool: sinon.stub().resolves([false, ""]),
			doesLatestTaskCompletionHaveNewChanges: sinon.stub().resolves(false),
			updateFCListFromToolResponse: sinon.stub().resolves(),
			sayAndCreateMissingParamError: sinon.stub().resolves(""),
			removeLastPartialMessageIfExistsWithType: sinon.stub().resolves(),
			shouldAutoApproveTool: sinon.stub().returns(false),
			shouldAutoApproveToolWithPath: sinon.stub().resolves(false),
			applyLatestBrowserSettings: sinon.stub().resolves(),
			switchToActMode: sinon.stub().resolves(false),
		},
		coordinator: {
			execute: sinon.stub().resolves("Success"),
			has: sinon.stub().returns(true),
			getHandler: sinon.stub().returns(null),
		} as any,
		preToolUseRunner: options.preToolUseRunner,
	}
}

/**
 * Creates a mock ToolUse block for testing
 */
export function createMockToolUse(name: ClineDefaultTool | string, params: any): ToolUse {
	return {
		type: "tool_use",
		name: name as ClineDefaultTool,
		params,
		partial: false,
	}
}

/**
 * Creates a minimal mock ToolExecutor for testing
 */
export function createMockToolExecutor(): any {
	const taskState = new TaskState()
	const messageStateHandler = {
		getClineMessages: sinon.stub().returns([]),
		addToClineMessages: sinon.stub().resolves(),
	} as any

	const mockStateManager = {
		getGlobalSettingsKey: sinon.stub().returns(false),
	} as any

	const executor = Object.create(ToolExecutor.prototype)
	executor.taskState = taskState
	executor.messageStateHandler = messageStateHandler
	executor.stateManager = mockStateManager

	// Add methods needed for testing
	executor.asToolConfig = () => createMockTaskConfig()

	executor.handleCompleteBlock = async function (block: ToolUse, config: any) {
		try {
			if (config.preToolUseRunner) {
				await config.preToolUseRunner.run()
			}
			await config.coordinator.execute(config, block)
		} finally {
			if (config.preToolUseRunner) {
				delete config.preToolUseRunner
			}
			if (this.taskState.currentToolAskMessageTs !== undefined) {
				this.taskState.currentToolAskMessageTs = undefined
			}
		}
	}

	return executor
}
