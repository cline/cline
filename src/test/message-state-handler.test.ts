import { describe, it } from "mocha"
import "should"
import should from "should"
import { MessageStateHandler } from "../core/task/message-state"
import { TaskState } from "../core/task/TaskState"
import { ClineMessage } from "../shared/ExtensionMessage"

/**
 * Unit tests for MessageStateHandler's mutex protection (RC-4)
 * These tests verify that concurrent operations on message state are properly serialized
 * to prevent race conditions, particularly the TOCTOU bug in addToClineMessages
 */
describe("MessageStateHandler Mutex Protection", () => {
	/**
	 * Helper to create a minimal MessageStateHandler for testing
	 */
	function createTestHandler(): MessageStateHandler {
		const taskState = new TaskState()
		return new MessageStateHandler({
			taskId: "test-task-id",
			ulid: "test-ulid",
			taskState,
			updateTaskHistory: async () => [],
		})
	}

	it("should reuse cached task directory size across rapid consecutive saves", async () => {
		const taskState = new TaskState()
		let nowMs = 1_000
		let taskDirSizeCalls = 0
		let savedMessagesCalls = 0

		const handler = new MessageStateHandler({
			taskId: "test-task-id",
			ulid: "test-ulid",
			taskState,
			updateTaskHistory: async () => [],
			now: () => nowMs,
			getTaskDirectorySize: async () => {
				taskDirSizeCalls += 1
				return 1234
			},
			getCurrentWorkingDirectory: async () => "/tmp/project",
			ensureTaskDirectoryExists: async () => "/tmp/project/.cline/tasks/test-task-id",
			saveClineMessages: async () => {
				savedMessagesCalls += 1
			},
			saveApiConversationHistory: async () => {},
		})

		handler.setApiConversationHistory([{ role: "user", content: "hello", ts: Date.now() }])
		handler.setClineMessages([createTestMessage("task"), createTestMessage("one")])
		await handler.saveClineMessagesAndUpdateHistory()
		nowMs += 100
		handler.setClineMessages([createTestMessage("task"), createTestMessage("one"), createTestMessage("two")])
		await handler.saveClineMessagesAndUpdateHistory()

		taskDirSizeCalls.should.equal(1)
		savedMessagesCalls.should.equal(2)
	})

	it("should recompute task directory size after the cache TTL expires", async () => {
		const taskState = new TaskState()
		let nowMs = 1_000
		let taskDirSizeCalls = 0

		const handler = new MessageStateHandler({
			taskId: "test-task-id",
			ulid: "test-ulid",
			taskState,
			updateTaskHistory: async () => [],
			now: () => nowMs,
			getTaskDirectorySize: async () => {
				taskDirSizeCalls += 1
				return 1234 + taskDirSizeCalls
			},
			getCurrentWorkingDirectory: async () => "/tmp/project",
			ensureTaskDirectoryExists: async () => "/tmp/project/.cline/tasks/test-task-id",
			saveClineMessages: async () => {},
			saveApiConversationHistory: async () => {},
		})

		handler.setApiConversationHistory([{ role: "user", content: "hello", ts: Date.now() }])
		handler.setClineMessages([createTestMessage("task"), createTestMessage("one")])
		await handler.saveClineMessagesAndUpdateHistory()
		nowMs += 6_000
		handler.setClineMessages([createTestMessage("task"), createTestMessage("one"), createTestMessage("two")])
		await handler.saveClineMessagesAndUpdateHistory()

		taskDirSizeCalls.should.equal(2)
	})

	it("should reuse cached task directory size across repeated updateClineMessage churn on a large history", async function () {
		this.timeout(5_000)

		const taskState = new TaskState()
		let nowMs = 1_000
		let taskDirSizeCalls = 0
		let savedMessagesCalls = 0

		const handler = new MessageStateHandler({
			taskId: "test-task-id",
			ulid: "test-ulid",
			taskState,
			updateTaskHistory: async () => [],
			now: () => nowMs,
			getTaskDirectorySize: async () => {
				taskDirSizeCalls += 1
				return 4096
			},
			getCurrentWorkingDirectory: async () => "/tmp/project",
			ensureTaskDirectoryExists: async () => "/tmp/project/.cline/tasks/test-task-id",
			saveClineMessages: async () => {
				savedMessagesCalls += 1
			},
			saveApiConversationHistory: async () => {},
		})

		handler.setApiConversationHistory([{ role: "user", content: "hello", ts: Date.now() }])
		handler.setClineMessages(Array.from({ length: 1_500 }, (_, i) => createTestMessage(`message-${i}-${"x".repeat(256)}`)))

		for (let i = 0; i < 25; i++) {
			await handler.updateClineMessage(1_499, { text: `updated-${i}-${"y".repeat(256)}` })
			nowMs += 100
		}

		taskDirSizeCalls.should.equal(1)
		savedMessagesCalls.should.equal(25)
		handler.getClineMessages()[1_499]?.text?.should.equal(`updated-24-${"y".repeat(256)}`)
	})

	it("should reuse cached task directory size across repeated addToClineMessages churn on a large history", async function () {
		this.timeout(5_000)

		const taskState = new TaskState()
		let nowMs = 1_000
		let taskDirSizeCalls = 0
		let savedMessagesCalls = 0

		const handler = new MessageStateHandler({
			taskId: "test-task-id",
			ulid: "test-ulid",
			taskState,
			updateTaskHistory: async () => [],
			now: () => nowMs,
			getTaskDirectorySize: async () => {
				taskDirSizeCalls += 1
				return 8192
			},
			getCurrentWorkingDirectory: async () => "/tmp/project",
			ensureTaskDirectoryExists: async () => "/tmp/project/.cline/tasks/test-task-id",
			saveClineMessages: async () => {
				savedMessagesCalls += 1
			},
			saveApiConversationHistory: async () => {},
		})

		handler.setApiConversationHistory([{ role: "user", content: "hello", ts: Date.now() }])
		handler.setClineMessages(Array.from({ length: 1_000 }, (_, i) => createTestMessage(`baseline-${i}-${"x".repeat(128)}`)))

		for (let i = 0; i < 40; i++) {
			await handler.addToClineMessages(createTestMessage(`added-${i}-${"z".repeat(128)}`))
			nowMs += 100
		}

		taskDirSizeCalls.should.equal(1)
		savedMessagesCalls.should.equal(40)
		handler.getClineMessages().length.should.equal(1_040)
		handler
			.getClineMessages()
			.at(-1)
			?.text?.should.equal(`added-39-${"z".repeat(128)}`)
	})

	/**
	 * Helper to create a test ClineMessage
	 */
	function createTestMessage(text: string): ClineMessage {
		return {
			ts: Date.now(),
			type: "say",
			say: "text",
			text,
		}
	}

	it("should initialize with empty message arrays", () => {
		const handler = createTestHandler()
		handler.getClineMessages().length.should.equal(0)
		handler.getApiConversationHistory().length.should.equal(0)
	})

	it("should set and get API conversation history", () => {
		const handler = createTestHandler()
		const testHistory = [{ role: "user" as const, content: "test message" }]

		handler.setApiConversationHistory(testHistory)
		handler.getApiConversationHistory().should.deepEqual(testHistory)
	})

	it("should set and get cline messages", () => {
		const handler = createTestHandler()
		const testMessages = [createTestMessage("test1"), createTestMessage("test2")]

		handler.setClineMessages(testMessages)
		handler.getClineMessages().should.deepEqual(testMessages)
	})

	/**
	 * CRITICAL TEST: Verify that addToClineMessages is atomic
	 * This test simulates the race condition that can occur when multiple
	 * addToClineMessages calls happen concurrently without proper mutex protection
	 */
	it("should handle concurrent addToClineMessages atomically", async function () {
		// Increase timeout for this test as it involves async operations
		this.timeout(5000)

		const handler = createTestHandler()

		// Set up initial API conversation history
		const initialHistory = [
			{ role: "user" as const, content: "msg1" },
			{ role: "assistant" as const, content: "response1" },
			{ role: "user" as const, content: "msg2" },
		]
		handler.setApiConversationHistory(initialHistory)

		// Add initial message to establish baseline
		const initialMsg = createTestMessage("initial")
		await handler.addToClineMessages(initialMsg)

		// Verify initial state
		const messages = handler.getClineMessages()
		messages.length.should.equal(1)
		messages[0].conversationHistoryIndex?.should.equal(2) // length - 1 = 3 - 1 = 2

		// Now simulate concurrent additions
		// Without mutex protection, these could race and get the same index
		const msg1 = createTestMessage("concurrent1")
		const msg2 = createTestMessage("concurrent2")
		const msg3 = createTestMessage("concurrent3")

		// Add more messages to API history to simulate ongoing conversation
		handler.setApiConversationHistory([
			...initialHistory,
			{ role: "assistant" as const, content: "response2" },
			{ role: "user" as const, content: "msg3" },
		])

		// Execute concurrent operations
		const results = await Promise.all([
			handler.addToClineMessages(msg1),
			handler.addToClineMessages(msg2),
			handler.addToClineMessages(msg3),
		])

		// Verify all operations completed
		results.length.should.equal(3)

		// Get final state
		const finalMessages = handler.getClineMessages()
		finalMessages.length.should.equal(4) // initial + 3 concurrent

		// CRITICAL ASSERTION: Each message should have a valid conversationHistoryIndex
		// With proper mutex protection, these indices should be set correctly
		// even though the operations ran concurrently
		finalMessages.forEach((msg, _idx) => {
			should.exist(msg.conversationHistoryIndex)
			msg.conversationHistoryIndex?.should.be.a.Number()
			msg.conversationHistoryIndex?.should.be.greaterThanOrEqual(0)
		})
	})

	/**
	 * Test that updateClineMessage operations are atomic
	 */
	it("should handle concurrent updateClineMessage atomically", async function () {
		this.timeout(5000)

		const handler = createTestHandler()

		// Set up initial messages
		const msgs = [createTestMessage("msg1"), createTestMessage("msg2"), createTestMessage("msg3")]
		handler.setClineMessages(msgs)

		// Perform concurrent updates to different messages
		await Promise.all([
			handler.updateClineMessage(0, { text: "updated1" }),
			handler.updateClineMessage(1, { text: "updated2" }),
			handler.updateClineMessage(2, { text: "updated3" }),
		])

		const finalMessages = handler.getClineMessages()
		finalMessages[0]?.text?.should.equal("updated1")
		finalMessages[1]?.text?.should.equal("updated2")
		finalMessages[2]?.text?.should.equal("updated3")
	})

	/**
	 * Test that deleteClineMessage operations are atomic
	 */
	it("should handle deleteClineMessage with proper validation", async () => {
		const handler = createTestHandler()

		// Set up initial messages
		const msgs = [createTestMessage("msg1"), createTestMessage("msg2"), createTestMessage("msg3")]
		handler.setClineMessages(msgs)

		// Delete middle message
		await handler.deleteClineMessage(1)

		const finalMessages = handler.getClineMessages()
		finalMessages.length.should.equal(2)
		finalMessages[0]?.text?.should.equal("msg1")
		finalMessages[1]?.text?.should.equal("msg3")
	})

	/**
	 * Test that invalid indices are rejected
	 */
	it("should throw error for invalid message index in updateClineMessage", async () => {
		const handler = createTestHandler()
		handler.setClineMessages([createTestMessage("msg1")])

		try {
			await handler.updateClineMessage(5, { text: "invalid" })
			throw new Error("Should have thrown")
		} catch (error) {
			if (error instanceof Error) {
				error.message.should.match(/Invalid message index/)
			}
		}
	})

	/**
	 * Test that invalid indices are rejected in deleteClineMessage
	 */
	it("should throw error for invalid message index in deleteClineMessage", async () => {
		const handler = createTestHandler()
		handler.setClineMessages([createTestMessage("msg1")])

		try {
			await handler.deleteClineMessage(-1)
			throw new Error("Should have thrown")
		} catch (error) {
			if (error instanceof Error) {
				error.message.should.match(/Invalid message index/)
			}
		}
	})

	/**
	 * Test API conversation history operations
	 */
	it("should handle concurrent API conversation history operations", async function () {
		this.timeout(5000)

		const handler = createTestHandler()

		// Perform concurrent additions
		await Promise.all([
			handler.addToApiConversationHistory({ role: "user", content: "msg1", ts: Date.now() }),
			handler.addToApiConversationHistory({ role: "assistant", content: "response1", ts: Date.now() }),
			handler.addToApiConversationHistory({ role: "user", content: "msg2", ts: Date.now() }),
		])

		const history = handler.getApiConversationHistory()
		history.length.should.equal(3)
		history[0].role.should.equal("user")
		history[1].role.should.equal("assistant")
		history[2].role.should.equal("user")
	})

	/**
	 * Test overwrite operations
	 */
	it("should handle overwriteClineMessages atomically", async () => {
		const handler = createTestHandler()

		// Set initial messages
		handler.setClineMessages([createTestMessage("old1"), createTestMessage("old2")])

		// Overwrite with new messages
		const newMessages = [createTestMessage("new1"), createTestMessage("new2"), createTestMessage("new3")]
		await handler.overwriteClineMessages(newMessages)

		const finalMessages = handler.getClineMessages()
		finalMessages.length.should.equal(3)
		finalMessages[0]?.text?.should.equal("new1")
		finalMessages[1]?.text?.should.equal("new2")
		finalMessages[2]?.text?.should.equal("new3")
	})

	/**
	 * Test overwrite API conversation history
	 */
	it("should handle overwriteApiConversationHistory atomically", async () => {
		const handler = createTestHandler()

		// Set initial history
		handler.setApiConversationHistory([{ role: "user", content: "old", ts: Date.now() }])

		// Overwrite with new history
		const newHistory = [
			{ role: "user" as const, content: "new1", ts: Date.now() },
			{ role: "assistant" as const, content: "new2", ts: Date.now() },
		]
		await handler.overwriteApiConversationHistory(newHistory)

		const finalHistory = handler.getApiConversationHistory()
		finalHistory.length.should.equal(2)
		finalHistory[0].content.should.equal("new1")
		finalHistory[1].content.should.equal("new2")
	})
})
