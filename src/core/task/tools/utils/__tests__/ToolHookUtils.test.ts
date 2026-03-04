import { describe, it } from "mocha"
import "should"
import type { ToolUse } from "@core/assistant-message"
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

		it("treats undefined hooksEnabled as disabled and returns early", async () => {
			const saySpy = sinon.spy(async () => Date.now())

			const config: any = {
				taskState: new TaskState(),
				services: {
					stateManager: {
						getGlobalSettingsKey: (_key: string) => undefined,
					},
				},
				callbacks: {
					say: saySpy,
					cancelTask: async () => {},
				},
			}

			const block: ToolUse = {
				type: "tool_use",
				name: ClineDefaultTool.BASH,
				params: { command: "echo hello", requires_approval: "false" },
				partial: false,
			}

			const shouldContinue = await ToolHookUtils.runPreToolUseIfEnabled(config, block)

			shouldContinue.should.equal(true)
			saySpy.called.should.equal(false)
			config.taskState.userMessageContent.should.have.length(0)
		})
	})
})
