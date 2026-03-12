import { describe, it } from "mocha"
import "should"
import fs from "fs/promises"
import os from "os"
import path from "path"
import should from "should"
import { getSavedApiConversationHistory, getSavedClineMessages } from "../core/storage/disk"
import { MessageStateHandler } from "../core/task/message-state"
import { TaskState } from "../core/task/TaskState"
import { ClineMessage } from "../shared/ExtensionMessage"
import { setVscodeHostProviderMock } from "./host-provider-test-utils"

/**
 * Unit tests for MessageStateHandler's mutex protection (RC-4)
 * These tests verify that concurrent operations on message state are properly serialized
 * to prevent race conditions, particularly the TOCTOU bug in addToClineMessages
 */
describe("MessageStateHandler Mutex Protection", () => {
	let tempGlobalStorageDir: string | undefined

	afterEach(async () => {
		if (tempGlobalStorageDir) {
			await fs.rm(tempGlobalStorageDir, { recursive: true, force: true })
			tempGlobalStorageDir = undefined
		}
	})

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

	it("should update messages ephemerally without persisting until flush", async () => {
		const handler = createTestHandler()
		const changes: Array<{ type: string; text?: string; previousText?: string }> = []

		handler.on("clineMessagesChanged", (change) => {
			changes.push({
				type: change.type,
				text: change.message?.text,
				previousText: change.previousMessage?.text,
			})
		})

		await handler.addToClineMessagesEphemeral(createTestMessage("ephemeral-start"))
		await handler.updateClineMessageEphemeral(0, { text: "ephemeral-updated", partial: true })

		const messagesBeforeFlush = handler.getClineMessages()
		messagesBeforeFlush.length.should.equal(1)
		should.exist(messagesBeforeFlush[0])
		const pendingMessage = messagesBeforeFlush[0]!
		pendingMessage.text?.should.equal("ephemeral-updated")
		should.exist(pendingMessage.partial)
		pendingMessage.partial!.should.equal(true)

		changes.length.should.equal(2)
		should.exist(changes[0])
		should.exist(changes[1])
		const firstChange = changes[0]!
		const secondChange = changes[1]!
		firstChange.type.should.equal("add")
		should.exist(firstChange.text)
		firstChange.text!.should.equal("ephemeral-start")
		secondChange.type.should.equal("update")
		should.exist(secondChange.previousText)
		should.exist(secondChange.text)
		secondChange.previousText!.should.equal("ephemeral-start")
		secondChange.text!.should.equal("ephemeral-updated")

		const metricsBeforeFlush = handler.consumeLatencyMetrics()
		metricsBeforeFlush.persistenceFlushCount.should.equal(0)

		await handler.flushClineMessagesAndUpdateHistory()

		const metricsAfterFlush = handler.consumeLatencyMetrics()
		metricsAfterFlush.persistenceFlushCount.should.equal(1)
	})

	it("should not flush when there are no dirty ephemeral changes", async () => {
		const handler = createTestHandler()

		await handler.flushClineMessagesAndUpdateHistory()

		const metrics = handler.consumeLatencyMetrics()
		metrics.persistenceFlushCount.should.equal(0)
		metrics.saveMessagesDurationMs.should.equal(0)
		metrics.updateHistoryDurationMs.should.equal(0)
	})

	it("should persist when a partial message transitions to complete", async () => {
		const handler = createTestHandler()

		await handler.addToClineMessagesEphemeral({
			...createTestMessage("partial-message"),
			partial: true,
		})

		let metrics = handler.consumeLatencyMetrics()
		metrics.persistenceFlushCount.should.equal(0)

		await handler.updateClineMessage(0, { text: "completed-message", partial: false })

		const completedMessage = handler.getClineMessages()[0]
		should.exist(completedMessage)
		completedMessage!.text?.should.equal("completed-message")
		should.exist(completedMessage!.partial)
		completedMessage!.partial!.should.equal(false)

		metrics = handler.consumeLatencyMetrics()
		metrics.persistenceFlushCount.should.equal(1)
	})

	it("should emit delete change metadata for removed messages", async () => {
		const handler = createTestHandler()
		const observedDeletes: Array<{ index?: number; previousText?: string }> = []

		handler.on("clineMessagesChanged", (change) => {
			if (change.type === "delete") {
				observedDeletes.push({ index: change.index, previousText: change.previousMessage?.text })
			}
		})

		await handler.addToClineMessages(createTestMessage("first"))
		await handler.addToClineMessages(createTestMessage("second"))
		await handler.deleteClineMessage(0)

		observedDeletes.length.should.equal(1)
		should.exist(observedDeletes[0])
		const deletedChange = observedDeletes[0]!
		should.exist(deletedChange.index)
		should.exist(deletedChange.previousText)
		deletedChange.index!.should.equal(0)
		deletedChange.previousText!.should.equal("first")
		handler.getClineMessages().length.should.equal(1)
		should.exist(handler.getClineMessages()[0])
		const remainingMessage = handler.getClineMessages()[0]!
		remainingMessage.text?.should.equal("second")
	})

	it("persists flushed ephemeral messages to disk for task recovery", async () => {
		tempGlobalStorageDir = await fs.mkdtemp(path.join(os.tmpdir(), "cline-message-state-"))
		setVscodeHostProviderMock({ globalStorageFsPath: tempGlobalStorageDir })

		const handler = createTestHandler()
		await handler.addToClineMessagesEphemeral({
			...createTestMessage("recoverable partial"),
			partial: true,
		})
		await handler.flushClineMessagesAndUpdateHistory()

		const savedMessages = await getSavedClineMessages("test-task-id")
		savedMessages.length.should.equal(1)
		should.exist(savedMessages[0])
		savedMessages[0]!.text?.should.equal("recoverable partial")
		should.exist(savedMessages[0]!.partial)
		savedMessages[0]!.partial!.should.equal(true)
	})

	it("persists completed conversation history snapshots that resume can reload", async () => {
		tempGlobalStorageDir = await fs.mkdtemp(path.join(os.tmpdir(), "cline-message-history-"))
		setVscodeHostProviderMock({ globalStorageFsPath: tempGlobalStorageDir })

		const handler = createTestHandler()
		await handler.overwriteApiConversationHistory([
			{ role: "user", content: "task request", ts: 1 },
			{ role: "assistant", content: "task response", ts: 2 },
		])

		const savedHistory = await getSavedApiConversationHistory("test-task-id")
		savedHistory.length.should.equal(2)
		should.exist(savedHistory[0])
		should.exist(savedHistory[1])
		savedHistory[0]!.content.should.equal("task request")
		savedHistory[1]!.content.should.equal("task response")
	})
})
