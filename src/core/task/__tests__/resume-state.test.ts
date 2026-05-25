import { strict as assert } from "node:assert"
import { getLastNonHookMessage, getResumeAskType } from "@core/task/resume-state"
import type { ClineMessage } from "@shared/ExtensionMessage"
import { describe, it } from "mocha"

function ask(ask: ClineMessage["ask"], ts: number): ClineMessage {
	return { type: "ask", ask, ts }
}

function say(say: ClineMessage["say"], ts: number): ClineMessage {
	return { type: "say", say, ts }
}

describe("resume-state", () => {
	it("keeps completed tasks completed when hook messages trail the result", () => {
		const messages = [ask("completion_result", 1), say("hook_status", 2), say("hook_output_stream", 3), ask("resume_task", 4)]

		assert.equal(getResumeAskType(messages), "resume_completed_task")
	})

	it("keeps active tasks resumable when hook messages trail work", () => {
		const messages = [say("text", 1), say("hook_status", 2)]

		assert.equal(getResumeAskType(messages), "resume_task")
	})

	it("ignores trailing hook messages for button-only state checks", () => {
		const messages = [ask("completion_result", 1), say("hook_status", 2)]

		assert.equal(getLastNonHookMessage(messages)?.ask, "completion_result")
	})
})
