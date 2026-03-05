import { describe, it } from "mocha"
import "should"
import type { ToolUse } from "@core/assistant-message"
import * as HookExecutor from "@core/hooks/hook-executor"
import { TaskState } from "@core/task/TaskState"
import { ClineDefaultTool } from "@shared/tools"
import * as sinon from "sinon"
import { ToolHookUtils } from "../ToolHookUtils"

describe("ToolHookUtils", () => {
	describe("runPreToolUseIfEnabled", () => {
		it("returns early without running hooks when hooks are disabled", async () => {
			const saySpy = sinon.spy(async () => Date.now())
			const cancelTaskSpy = sinon.spy(async () => {})

			const config: any = {
				taskState: new TaskState(),
				services: {
					stateManager: {
						getGlobalSettingsKey: (key: string) => (key === "hooksEnabled" ? false : undefined),
					},
				},
				callbacks: {
					say: saySpy,
					cancelTask: cancelTaskSpy,
				},
			}

			const block: ToolUse = {
				type: "tool_use",
				name: ClineDefaultTool.FILE_READ,
				params: { path: "src/index.ts" },
				partial: false,
			}

			const shouldContinue = await ToolHookUtils.runPreToolUseIfEnabled(config, block)

			shouldContinue.should.equal(true)
			saySpy.called.should.equal(false)
			cancelTaskSpy.called.should.equal(false)
			config.taskState.userMessageContent.should.have.length(0)
		})

		it("treats undefined hooksEnabled as enabled and runs hook flow", async () => {
			const saySpy = sinon.spy(async () => Date.now())
			const executeHookStub = sinon.stub(HookExecutor, "executeHook").resolves({ wasCancelled: false })
			const getGlobalSettingsKeySpy = sinon.spy((key: string) => (key === "mode" ? "act" : undefined))
			const getApiConfigurationSpy = sinon.spy(() => ({
				actModeApiProvider: undefined,
				planModeApiProvider: undefined,
			}))
			const getModelSpy = sinon.spy(() => ({ id: "test-model" }))

			const config: any = {
				taskState: new TaskState(),
				taskId: "test-task-id",
				api: {
					getModel: getModelSpy,
				},
				messageState: {},
				services: {
					stateManager: {
						getGlobalSettingsKey: getGlobalSettingsKeySpy,
						getApiConfiguration: getApiConfigurationSpy,
					},
				},
				callbacks: {
					say: saySpy,
					cancelTask: async () => {},
					setActiveHookExecution: async () => {},
					clearActiveHookExecution: async () => {},
				},
			}

			const block: ToolUse = {
				type: "tool_use",
				name: ClineDefaultTool.BASH,
				params: { command: "echo hello", requires_approval: "false" },
				partial: false,
			}

			try {
				const shouldContinue = await ToolHookUtils.runPreToolUseIfEnabled(config, block)

				shouldContinue.should.equal(true)
				saySpy.called.should.equal(false)
				executeHookStub.calledOnce.should.equal(true)
				getGlobalSettingsKeySpy.calledWith("hooksEnabled").should.equal(true)
				getGlobalSettingsKeySpy.calledWith("mode").should.equal(true)
				getApiConfigurationSpy.called.should.equal(true)
				getModelSpy.called.should.equal(true)
				config.taskState.userMessageContent.should.have.length(0)
			} finally {
				executeHookStub.restore()
			}
		})
	})
})
