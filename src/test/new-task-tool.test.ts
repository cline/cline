import * as assert from "assert"
import { describe, it } from "mocha"
import { ClineMessage } from "../shared/ExtensionMessage"
import { formatResponse } from "../core/prompts/responses"

describe("New Task Tool Tests", () => {
	it("formatResponse.newTaskContext formats context correctly", () => {
		const context = "This is a test context for a new task"
		const result = formatResponse.newTaskContext(context)

		assert.strictEqual(
			result,
			`Cline wants to start a new task with the following context:\n\nThis is a test context for a new task\n\nClick "Start New Task" to start a new task with this context preloaded.`,
		)
	})

	it("ClineAskNewTask interface exists", () => {
		// This is a type check test, it will fail at compile time if the interface doesn't exist
		const message: ClineMessage = {
			ts: Date.now(),
			type: "ask",
			ask: "new_task",
			text: JSON.stringify({ context: "Test context" }),
		}

		assert.ok(message)
	})
})
