import { describe, it } from "mocha"
import "should"
import type { ToolUse } from "@core/assistant-message"
import { TaskState } from "../../../TaskState"
import type { TaskConfig } from "../../types/TaskConfig"
import { AttemptCompletionHandler, hasPerformedRealWorkThisResponse } from "../AttemptCompletionHandler"

describe("AttemptCompletionHandler", () => {
	describe("hasPerformedRealWorkThisResponse", () => {
		it("should report false when no actions were taken", () => {
			const state = new TaskState()
			hasPerformedRealWorkThisResponse(state).should.be.false()
		})

		it("should report true when a command was executed", () => {
			const state = new TaskState()
			state.didRunCommandThisResponse = true
			hasPerformedRealWorkThisResponse(state).should.be.true()
		})

		it("should report true when a file was read", () => {
			const state = new TaskState()
			state.didReadProjectFileThisResponse = true
			hasPerformedRealWorkThisResponse(state).should.be.true()
		})

		it("should report true when a file was edited", () => {
			const state = new TaskState()
			state.didEditFileThisResponse = true
			hasPerformedRealWorkThisResponse(state).should.be.true()
		})
	})

	describe("execute", () => {
		it("should block completion when no real work occurred", async () => {
			const handler = new AttemptCompletionHandler()
			const config = { taskState: new TaskState() } as unknown as TaskConfig
			const block = {
				name: "attempt_completion",
				params: {
					result: "All done",
				},
			} as ToolUse

			const result = await handler.execute(config, block)

			result.should.be.a.String()
			result.should.containEql("Attempt completion blocked")
		})
	})
})
