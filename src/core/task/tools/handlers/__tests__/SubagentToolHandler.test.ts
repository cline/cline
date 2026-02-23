import { strict as assert } from "node:assert"
import { setTimeout as delay } from "node:timers/promises"
import { ClineSubagentUsageInfo } from "@shared/ExtensionMessage"
import { ClineDefaultTool } from "@shared/tools"
import { afterEach, describe, it } from "mocha"
import sinon from "sinon"
import { TaskState } from "../../../TaskState"
import { SubagentRunner } from "../../subagent/SubagentRunner"
import type { TaskConfig } from "../../types/TaskConfig"
import { createUIHelpers } from "../../types/UIHelpers"
import { UseSubagentsToolHandler } from "../SubagentToolHandler"

function createConfig(options?: {
	autoApproveSafe?: boolean
	autoApproveAll?: boolean
	taskAskResponse?: "yesButtonClicked" | "noButtonClicked"
	subagentsEnabled?: boolean
}) {
	const taskState = new TaskState()
	const askResponse = options?.taskAskResponse ?? "yesButtonClicked"
	const subagentsEnabled = options?.subagentsEnabled ?? true

	const callbacks = {
		say: sinon.stub().resolves(undefined),
		ask: sinon.stub().resolves({ response: askResponse }),
		saveCheckpoint: sinon.stub().resolves(),
		sayAndCreateMissingParamError: sinon.stub().resolves("missing"),
		removeLastPartialMessageIfExistsWithType: sinon.stub().resolves(),
		executeCommandTool: sinon.stub().resolves([false, "ok"]),
		cancelRunningCommandTool: sinon.stub().resolves(false),
		doesLatestTaskCompletionHaveNewChanges: sinon.stub().resolves(false),
		updateFCListFromToolResponse: sinon.stub().resolves(),
		shouldAutoApproveTool: sinon.stub().returns([options?.autoApproveSafe ?? false, options?.autoApproveAll ?? false]),
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
		vscodeTerminalExecutionMode: "backgroundExec",
		enableParallelToolCalling: true,
		context: {},
		taskState,
		messageState: {},
		api: {
			getModel: () => ({ id: "openai/gpt-5", info: {} }),
		},
		autoApprovalSettings: {
			enableNotifications: false,
			actions: {
				executeSafeCommands: false,
				executeAllCommands: false,
			},
		},
		autoApprover: {
			shouldAutoApproveTool: sinon.stub().returns([options?.autoApproveSafe ?? false, options?.autoApproveAll ?? false]),
		},
		browserSettings: {},
		focusChainSettings: {},
		services: {
			stateManager: {
				getGlobalStateKey: (key: string) => (key === "nativeToolCallEnabled" ? true : undefined),
				getGlobalSettingsKey: (key: string) => {
					if (key === "mode") {
						return "act"
					}
					if (key === "customPrompt") {
						return undefined
					}
					if (key === "subagentsEnabled") {
						return subagentsEnabled
					}
					return undefined
				},
				getApiConfiguration: () => ({
					planModeApiProvider: "openai",
					actModeApiProvider: "openai",
				}),
			},
			mcpHub: {},
		},
		callbacks,
		coordinator: {
			getHandler: sinon.stub(),
		},
	} as unknown as TaskConfig

	return { config, callbacks, taskState }
}

describe("SubagentToolHandler", () => {
	afterEach(() => {
		sinon.restore()
	})

	it("returns missing parameter error when no prompts are provided", async () => {
		const { config, callbacks, taskState } = createConfig()
		const handler = new UseSubagentsToolHandler()

		const result = await handler.execute(config, {
			type: "tool_use",
			name: ClineDefaultTool.USE_SUBAGENTS,
			params: {},
			partial: false,
		})

		assert.equal(result, "missing")
		assert.equal(taskState.consecutiveMistakeCount, 1)
		sinon.assert.calledOnce(callbacks.sayAndCreateMissingParamError)
	})

	it("returns an error when subagents are disabled", async () => {
		const { config } = createConfig({ subagentsEnabled: false })
		const handler = new UseSubagentsToolHandler()

		const result = await handler.execute(config, {
			type: "tool_use",
			name: ClineDefaultTool.USE_SUBAGENTS,
			params: {
				prompt_1: "first prompt",
			},
			partial: false,
		})

		assert.equal(
			result,
			"The tool execution failed with the following error:\n<error>\nSubagents are disabled. Enable them in Settings > Features to use this tool.\n</error>",
		)
	})

	it("streams partial use_subagents approval as ask when not auto-approved", async () => {
		const { config, callbacks } = createConfig({ autoApproveSafe: false, autoApproveAll: false })
		const handler = new UseSubagentsToolHandler()
		const uiHelpers = createUIHelpers(config)

		await handler.handlePartialBlock(
			{
				type: "tool_use",
				name: ClineDefaultTool.USE_SUBAGENTS,
				params: {
					prompt_1: "first prompt",
					prompt_2: "second prompt",
				},
				partial: true,
			},
			uiHelpers,
		)

		sinon.assert.calledOnce(callbacks.removeLastPartialMessageIfExistsWithType)
		sinon.assert.calledWithExactly(callbacks.removeLastPartialMessageIfExistsWithType, "say", "use_subagents")
		sinon.assert.calledOnce(callbacks.ask)
		sinon.assert.calledWithMatch(callbacks.ask, "use_subagents", sinon.match.string, true)

		const payload = JSON.parse(callbacks.ask.firstCall.args[1])
		assert.deepEqual(payload.prompts, ["first prompt", "second prompt"])
		sinon.assert.notCalled(callbacks.say)
	})

	it("streams partial use_subagents approval as say when auto-approved", async () => {
		const { config, callbacks } = createConfig({ autoApproveSafe: true, autoApproveAll: false })
		const handler = new UseSubagentsToolHandler()
		const uiHelpers = createUIHelpers(config)

		await handler.handlePartialBlock(
			{
				type: "tool_use",
				name: ClineDefaultTool.USE_SUBAGENTS,
				params: {
					prompt_1: "first prompt",
					prompt_2: "second prompt",
				},
				partial: true,
			},
			uiHelpers,
		)

		sinon.assert.calledOnce(callbacks.removeLastPartialMessageIfExistsWithType)
		sinon.assert.calledWithExactly(callbacks.removeLastPartialMessageIfExistsWithType, "ask", "use_subagents")
		sinon.assert.calledOnce(callbacks.say)
		sinon.assert.calledWithMatch(callbacks.say, "use_subagents", sinon.match.string, undefined, undefined, true)

		const payload = JSON.parse(callbacks.say.firstCall.args[1])
		assert.deepEqual(payload.prompts, ["first prompt", "second prompt"])
		sinon.assert.notCalled(callbacks.ask)
	})

	it("uses one approval for the full batch and stops on denial", async () => {
		const { config, callbacks, taskState } = createConfig({ taskAskResponse: "noButtonClicked" })
		const runStub = sinon.stub(SubagentRunner.prototype, "run")
		const handler = new UseSubagentsToolHandler()

		const result = await handler.execute(config, {
			type: "tool_use",
			name: ClineDefaultTool.USE_SUBAGENTS,
			params: {
				prompt_1: "one",
				prompt_2: "two",
			},
			partial: false,
		})

		assert.equal(result, "The user denied this operation.")
		assert.equal(taskState.didRejectTool, true)
		sinon.assert.calledOnce(callbacks.ask)
		assert.equal(callbacks.ask.firstCall.args[0], "use_subagents")
		sinon.assert.notCalled(runStub)
	})

	it("uses read-file auto-approve level (safe only) for approval bypass", async () => {
		const { config, callbacks } = createConfig({ autoApproveSafe: true, autoApproveAll: false })
		sinon.stub(SubagentRunner.prototype, "run").resolves({
			status: "completed",
			result: "done",
			stats: {
				toolCalls: 1,
				inputTokens: 2,
				outputTokens: 3,
				cacheWriteTokens: 0,
				cacheReadTokens: 0,
				totalCost: 0.25,
				contextTokens: 5,
				contextWindow: 200000,
				contextUsagePercentage: 0.0025,
			},
		})

		const handler = new UseSubagentsToolHandler()
		await handler.execute(config, {
			type: "tool_use",
			name: ClineDefaultTool.USE_SUBAGENTS,
			params: {
				prompt_1: "one",
			},
			partial: false,
		})

		sinon.assert.notCalled(callbacks.ask)
		const subagentStatusCalls = callbacks.say.getCalls().filter((call) => call.args[0] === "subagent")
		assert.ok(subagentStatusCalls.length >= 1)
	})

	it("fans out prompts in parallel and emits aggregated status", async () => {
		const { config, callbacks } = createConfig({ autoApproveSafe: true, autoApproveAll: true })
		let activeRuns = 0
		let maxActiveRuns = 0

		sinon.stub(SubagentRunner.prototype, "run").callsFake(async (_prompt: string, onProgress) => {
			activeRuns++
			maxActiveRuns = Math.max(maxActiveRuns, activeRuns)
			onProgress({
				status: "running",
				stats: {
					toolCalls: 0,
					inputTokens: 0,
					outputTokens: 0,
					cacheWriteTokens: 0,
					cacheReadTokens: 0,
					totalCost: 0,
					contextTokens: 0,
					contextWindow: 200000,
					contextUsagePercentage: 0,
				},
			})
			await delay(10)
			activeRuns--
			return {
				status: "completed",
				result: "done",
				stats: {
					toolCalls: 1,
					inputTokens: 2,
					outputTokens: 3,
					cacheWriteTokens: 0,
					cacheReadTokens: 0,
					totalCost: 0.25,
					contextTokens: 5,
					contextWindow: 200000,
					contextUsagePercentage: 0.0025,
				},
			}
		})

		const handler = new UseSubagentsToolHandler()
		const result = await handler.execute(config, {
			type: "tool_use",
			name: ClineDefaultTool.USE_SUBAGENTS,
			params: {
				prompt_1: "one",
				prompt_2: "two",
				prompt_3: "three",
			},
			partial: false,
		})

		assert.equal(typeof result, "string")
		assert.ok((result as string).includes("Total: 3"))
		assert.ok(maxActiveRuns > 1)

		const subagentStatusCalls = callbacks.say.getCalls().filter((call) => call.args[0] === "subagent")
		assert.ok(subagentStatusCalls.length >= 2)
		const finalCall = subagentStatusCalls[subagentStatusCalls.length - 1]
		assert.equal(finalCall.args[4], false)

		const usageCalls = callbacks.say.getCalls().filter((call) => call.args[0] === "subagent_usage")
		assert.equal(usageCalls.length, 1)
		const usagePayload = JSON.parse(usageCalls[0].args[1]) as ClineSubagentUsageInfo
		assert.equal(usagePayload.source, "subagents")
		assert.equal(usagePayload.tokensIn, 6)
		assert.equal(usagePayload.tokensOut, 9)
		assert.equal(usagePayload.cacheWrites, 0)
		assert.equal(usagePayload.cacheReads, 0)
		assert.equal(usagePayload.cost, 0.75)
	})

	it("continues after per-subagent failures and reports both outcomes", async () => {
		const { config } = createConfig({ autoApproveSafe: true, autoApproveAll: true })

		sinon.stub(SubagentRunner.prototype, "run").callsFake(async (prompt: string) => {
			if (prompt.includes("fail")) {
				return {
					status: "failed",
					error: "boom",
					stats: {
						toolCalls: 1,
						inputTokens: 0,
						outputTokens: 0,
						cacheWriteTokens: 0,
						cacheReadTokens: 0,
						totalCost: 0,
						contextTokens: 0,
						contextWindow: 200000,
						contextUsagePercentage: 0,
					},
				}
			}
			return {
				status: "completed",
				result: "ok",
				stats: {
					toolCalls: 2,
					inputTokens: 0,
					outputTokens: 0,
					cacheWriteTokens: 0,
					cacheReadTokens: 0,
					totalCost: 0,
					contextTokens: 0,
					contextWindow: 200000,
					contextUsagePercentage: 0,
				},
			}
		})

		const handler = new UseSubagentsToolHandler()
		const result = await handler.execute(config, {
			type: "tool_use",
			name: ClineDefaultTool.USE_SUBAGENTS,
			params: {
				prompt_1: "succeed",
				prompt_2: "fail",
			},
			partial: false,
		})

		assert.equal(typeof result, "string")
		assert.ok((result as string).includes("Succeeded: 1"))
		assert.ok((result as string).includes("Failed: 1"))
		assert.ok((result as string).includes("boom"))
	})
})
