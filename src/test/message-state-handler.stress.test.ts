import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import { MessageStateHandler } from "../core/task/message-state"
import { TaskState } from "../core/task/TaskState"
import type { ClineMessage } from "../shared/ExtensionMessage"
import { measureAsyncOperation } from "./stress-utils"

function createTestMessage(text: string): ClineMessage {
	return {
		ts: Date.now(),
		type: "say",
		say: "text",
		text,
	}
}

describe("MessageStateHandler soak", () => {
	it("handles 10,000 incremental message updates within a bounded budget", async function () {
		this.timeout(30_000)

		const taskState = new TaskState()
		let saveCalls = 0
		let historyCalls = 0

		const handler = new MessageStateHandler({
			taskId: "stress-task-id",
			ulid: "stress-ulid",
			taskState,
			updateTaskHistory: async () => {
				historyCalls += 1
				return []
			},
			getTaskDirectorySize: async () => 32_768,
			getCurrentWorkingDirectory: async () => "/tmp/project",
			ensureTaskDirectoryExists: async () => "/tmp/project/.cline/tasks/stress-task-id",
			saveClineMessages: async () => {
				saveCalls += 1
			},
			saveApiConversationHistory: async () => {},
		})

		handler.setApiConversationHistory([{ role: "user", content: "seed", ts: Date.now() }] as any)
		handler.setClineMessages([createTestMessage("task-seed")])

		const measured = await measureAsyncOperation("message-state 10k incremental updates", async () => {
			for (let i = 0; i < 10_000; i++) {
				await handler.addToClineMessages(createTestMessage(`message-${i}-${"x".repeat(64)}`))
			}

			return handler.getClineMessages().length
		})

		assert.equal(measured.result, 10_001)
		assert.equal(handler.getClineMessages().length, 10_001)
		assert.equal(handler.getClineMessages().at(-1)?.text, `message-9999-${"x".repeat(64)}`)
		assert.equal(saveCalls, 10_000)
		assert.equal(historyCalls, 10_000)
		assert.ok(measured.durationMs < 30_000)
		assert.ok(measured.diff.heapUsedDelta < 256 * 1024 * 1024)
	})
})
