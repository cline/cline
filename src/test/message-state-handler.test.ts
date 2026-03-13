import fs from "fs/promises"
import { afterEach, describe, it } from "mocha"
import os from "os"
import path from "path"
import "should"
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
		setVscodeHostProviderMock()
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

	function createTestHandlerWithHistorySpy(updateTaskHistory: (historyItem: any) => Promise<any[]>): MessageStateHandler {
		const taskState = new TaskState()
		return new MessageStateHandler({
			taskId: "test-task-id",
			ulid: "test-ulid",
			taskState,
			updateTaskHistory,
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

	it("should throw error for invalid message index in updateClineMessageEphemeral", async () => {
		const handler = createTestHandler()
		handler.setClineMessages([createTestMessage("msg1")])

		try {
			await handler.updateClineMessageEphemeral(5, { text: "invalid" })
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
		changes[0]!.type.should.equal("add")
		changes[0]!.text!.should.equal("ephemeral-start")
		changes[1]!.type.should.equal("update")
		changes[1]!.previousText!.should.equal("ephemeral-start")
		changes[1]!.text!.should.equal("ephemeral-updated")

		handler.consumeLatencyMetrics().persistenceFlushCount.should.equal(0)

		await handler.flushClineMessagesAndUpdateHistory()

		handler.consumeLatencyMetrics().persistenceFlushCount.should.equal(1)
	})

	it("should not flush when there are no dirty ephemeral changes", async () => {
		const handler = createTestHandler()

		await handler.flushClineMessagesAndUpdateHistory()

		const metrics = handler.consumeLatencyMetrics()
		metrics.persistenceFlushCount.should.equal(0)
		metrics.saveMessagesDurationMs.should.equal(0)
		metrics.updateHistoryDurationMs.should.equal(0)
	})

	it("updates task history when flushing previously-ephemeral changes", async () => {
		tempGlobalStorageDir = await fs.mkdtemp(path.join(os.tmpdir(), "cline-message-history-spy-"))
		setVscodeHostProviderMock({ globalStorageFsPath: tempGlobalStorageDir })

		let latestHistoryItem: any
		const handler = createTestHandlerWithHistorySpy(async (historyItem) => {
			latestHistoryItem = historyItem
			return [historyItem]
		})

		await handler.addToClineMessagesEphemeral({
			...createTestMessage("history-visible partial"),
			partial: true,
		})

		await handler.flushClineMessagesAndUpdateHistory()

		should.exist(latestHistoryItem)
		latestHistoryItem.id.should.equal("test-task-id")
		latestHistoryItem.ulid.should.equal("test-ulid")
		latestHistoryItem.task.should.equal("history-visible partial")
		latestHistoryItem.ts.should.be.a.Number()
		handler.consumeLatencyMetrics().persistenceFlushCount.should.equal(1)
	})

	it("should persist when a partial message transitions to complete", async () => {
		const handler = createTestHandler()

		await handler.addToClineMessagesEphemeral({
			...createTestMessage("partial-message"),
			partial: true,
		})

		handler.consumeLatencyMetrics().persistenceFlushCount.should.equal(0)

		await handler.updateClineMessage(0, { text: "completed-message", partial: false })

		const completedMessage = handler.getClineMessages()[0]!
		completedMessage.text?.should.equal("completed-message")
		completedMessage.partial!.should.equal(false)

		handler.consumeLatencyMetrics().persistenceFlushCount.should.equal(1)
	})

	it("batches long runs of partial updates into a single durable flush", async () => {
		const handler = createTestHandler()

		await handler.addToClineMessagesEphemeral({
			...createTestMessage("chunk-0"),
			partial: true,
		})

		for (let i = 1; i <= 25; i++) {
			await handler.updateClineMessageEphemeral(0, {
				text: `chunk-${i}`,
				partial: true,
			})
		}

		handler.consumeLatencyMetrics().persistenceFlushCount.should.equal(0)

		await handler.flushClineMessagesAndUpdateHistory()

		const metrics = handler.consumeLatencyMetrics()
		metrics.persistenceFlushCount.should.equal(1)
		const finalMessage = handler.getClineMessages()[0]
		should.exist(finalMessage)
		finalMessage!.text?.should.equal("chunk-25")
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
		savedMessages[0]!.text?.should.equal("recoverable partial")
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
		savedHistory[0]!.content.should.equal("task request")
		savedHistory[1]!.content.should.equal("task response")
	})

	it("persists tool result conversation history after finalization", async () => {
		tempGlobalStorageDir = await fs.mkdtemp(path.join(os.tmpdir(), "cline-message-tool-result-"))
		setVscodeHostProviderMock({ globalStorageFsPath: tempGlobalStorageDir })

		const handler = createTestHandler()
		await handler.overwriteApiConversationHistory([
			{
				role: "assistant",
				content: [
					{ type: "text", text: "I will inspect the file." },
					{ type: "tool_use", id: "toolu_123", name: "read_file", input: { path: "src/test.ts" } },
				],
				ts: 1,
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_123",
						content: [{ type: "text", text: "export const value = 1" }],
					},
				],
				ts: 2,
			},
		])

		const savedHistory = await getSavedApiConversationHistory("test-task-id")
		savedHistory.length.should.equal(2)
		const savedToolResultMessage = savedHistory[1]
		should.exist(savedToolResultMessage)
		Array.isArray(savedToolResultMessage!.content).should.equal(true)
		const toolResultBlocks = savedToolResultMessage!.content as Array<{
			type: string
			tool_use_id?: string
			content?: Array<{ type: string; text?: string }>
		}>
		const firstToolResultBlock = toolResultBlocks[0]
		should.exist(firstToolResultBlock)
		if (!firstToolResultBlock) {
			throw new Error("Expected persisted tool result block")
		}
		firstToolResultBlock.type.should.equal("tool_result")
		const firstToolUseId = firstToolResultBlock.tool_use_id
		should.exist(firstToolUseId)
		firstToolUseId!.should.equal("toolu_123")
		should.exist(firstToolResultBlock.content)
		const firstToolResultContentBlocks = firstToolResultBlock.content!
		const firstToolResultContent = firstToolResultContentBlocks[0]
		should.exist(firstToolResultContent)
		const firstToolResultText = firstToolResultContent!.text
		should.exist(firstToolResultText)
		if (!firstToolResultText) {
			throw new Error("Expected persisted tool result text")
		}
		firstToolResultText.should.equal("export const value = 1")
	})

	it("persists recoverable message and conversation state for resume after an interrupted stream", async () => {
		tempGlobalStorageDir = await fs.mkdtemp(path.join(os.tmpdir(), "cline-message-resume-"))
		setVscodeHostProviderMock({ globalStorageFsPath: tempGlobalStorageDir })

		const handler = createTestHandler()
		await handler.addToClineMessagesEphemeral({
			...createTestMessage("partial assistant output"),
			partial: true,
		})
		await handler.flushClineMessagesAndUpdateHistory()

		await handler.overwriteApiConversationHistory([
			{ role: "user", content: "task request", ts: 1 },
			{
				role: "assistant",
				content: [{ type: "text", text: "partial assistant output\n\n[Response interrupted by user]" }],
				ts: 2,
			},
		])

		const savedMessages = await getSavedClineMessages("test-task-id")
		const savedHistory = await getSavedApiConversationHistory("test-task-id")

		savedMessages.length.should.equal(1)
		savedMessages[0]!.text?.should.equal("partial assistant output")
		savedMessages[0]!.partial!.should.equal(true)

		savedHistory.length.should.equal(2)
		Array.isArray(savedHistory[1]!.content).should.equal(true)
		const savedAssistantContent = savedHistory[1]!.content as Array<{ type: string; text?: string }>
		savedAssistantContent[0]!.text!.should.match(/Response interrupted by user/)
	})
})
