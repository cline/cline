import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import sinon from "sinon"
import { TaskState } from "../../../TaskState"
import type { TaskConfig } from "../../types/TaskConfig"
import { WriteToFileToolHandler } from "../WriteToFileToolHandler"

function createConfig(options?: {
	consecutiveMistakeCount?: number
	contextWindow?: number
	clineMessages?: Array<{ type: string; say?: string; text?: string }>
}) {
	const taskState = new TaskState()
	taskState.consecutiveMistakeCount = options?.consecutiveMistakeCount ?? 0

	const callbacks = {
		say: sinon.stub().resolves(undefined),
		ask: sinon.stub().resolves({ response: "yesButtonClicked" }),
		saveCheckpoint: sinon.stub().resolves(),
		sayAndCreateMissingParamError: sinon.stub().resolves("missing"),
		removeLastPartialMessageIfExistsWithType: sinon.stub().resolves(),
		executeCommandTool: sinon.stub().resolves([false, "ok"]),
		cancelRunningCommandTool: sinon.stub().resolves(false),
		doesLatestTaskCompletionHaveNewChanges: sinon.stub().resolves(false),
		updateFCListFromToolResponse: sinon.stub().resolves(),
		shouldAutoApproveTool: sinon.stub().returns([false, false]),
		shouldAutoApproveToolWithPath: sinon.stub().resolves(false),
		postStateToWebview: sinon.stub().resolves(),
		reinitExistingTaskFromId: sinon.stub().resolves(),
		cancelTask: sinon.stub().resolves(),
		updateTaskHistory: sinon.stub().resolves([]),
		applyLatestBrowserSettings: sinon.stub().resolves(undefined),
		switchToActMode: sinon.stub().resolves(false),
		setActiveHookExecution: sinon.stub().resolves(),
		clearActiveHookExecution: sinon.stub().resolves(),
		getActiveHookExecution: sinon.stub().resolves(undefined),
		runUserPromptSubmitHook: sinon.stub().resolves({}),
	}

	const config = {
		taskId: "task-1",
		ulid: "ulid-1",
		cwd: "/tmp",
		mode: "act",
		strictPlanModeEnabled: false,
		yoloModeToggled: false,
		doubleCheckCompletionEnabled: false,
		vscodeTerminalExecutionMode: "backgroundExec",
		enableParallelToolCalling: false,
		isSubagentExecution: false,
		context: {},
		taskState,
		messageState: {
			getClineMessages: sinon.stub().returns(options?.clineMessages ?? []),
		},
		api: {
			getModel: sinon.stub().returns({
				id: "openai/gpt-5",
				info: { contextWindow: options?.contextWindow ?? 100 },
			}),
		},
		autoApprovalSettings: {
			enableNotifications: false,
			actions: {
				executeSafeCommands: false,
				executeAllCommands: false,
			},
		},
		autoApprover: {
			shouldAutoApproveTool: sinon.stub().returns([false, false]),
		},
		browserSettings: {},
		focusChainSettings: {},
		services: {
			diffViewProvider: {
				reset: sinon.stub().resolves(),
			},
			stateManager: {
				getApiConfiguration: sinon.stub().returns({
					planModeApiProvider: "openai",
					actModeApiProvider: "openai",
				}),
				getGlobalSettingsKey: sinon.stub().returns("act"),
			},
		},
		callbacks,
		coordinator: {},
	} as unknown as TaskConfig

	return { config, callbacks, taskState }
}

describe("WriteToFileToolHandler missing-content error handling", () => {
	afterEach(() => {
		sinon.restore()
	})

	it("increments counter and returns specialized first-failure tool error", async () => {
		const { config, callbacks, taskState } = createConfig({
			consecutiveMistakeCount: 0,
			contextWindow: 100,
			clineMessages: [{ type: "say", say: "api_req_started", text: JSON.stringify({ tokensIn: 10, tokensOut: 10 }) }],
		})
		const handler = new WriteToFileToolHandler({} as never)

		const result = await handler.execute(
			config,
			{ type: "tool_use", name: "write_to_file", params: { path: "src/index.ts" }, partial: false } as never,
		)

		assert.equal(taskState.consecutiveMistakeCount, 1)
		sinon.assert.calledOnce((config.services as any).diffViewProvider.reset)
		sinon.assert.calledOnce(callbacks.say)
		sinon.assert.calledWithMatch(callbacks.say, "error", sinon.match("Retrying..."))
		assert.match(result as string, /The tool execution failed with the following error:/)
		assert.match(result as string, /Failed to write to 'src\/index.ts': The 'content' parameter was empty/)
		assert.doesNotMatch(result as string, /Context window is/)
	})

	it("uses latest api_req_started tokens to compute warning percent", async () => {
		const { config } = createConfig({
			contextWindow: 100,
			clineMessages: [
				{ type: "say", say: "api_req_started", text: JSON.stringify({ tokensIn: 20, tokensOut: 10 }) }, // 30%
				{ type: "say", say: "api_req_started", text: JSON.stringify({ tokensIn: 40, tokensOut: 15, cacheWrites: 5 }) }, // 60%
			],
		})
		const handler = new WriteToFileToolHandler({} as never)

		const result = await handler.execute(
			config,
			{ type: "tool_use", name: "write_to_file", params: { path: "src/large.ts" }, partial: false } as never,
		)

		assert.match(result as string, /Context window is 60% full/)
		assert.doesNotMatch(result as string, /Context window is 30% full/)
	})

	it("uses second-failure wording and no context warning when usage unavailable", async () => {
		const { config, callbacks, taskState } = createConfig({
			consecutiveMistakeCount: 1,
			contextWindow: 100,
			clineMessages: [{ type: "say", say: "api_req_started", text: JSON.stringify({ request: "no token usage yet" }) }],
		})
		const handler = new WriteToFileToolHandler({} as never)

		const result = await handler.execute(
			config,
			{ type: "tool_use", name: "write_to_file", params: { path: "src/retry.ts" }, partial: false } as never,
		)

		assert.equal(taskState.consecutiveMistakeCount, 2)
		sinon.assert.calledWithMatch(callbacks.say, "error", sinon.match("This has happened multiple times"))
		assert.match(result as string, /This is your 2nd failed attempt/)
		assert.doesNotMatch(result as string, /Context window is/)
	})
})
