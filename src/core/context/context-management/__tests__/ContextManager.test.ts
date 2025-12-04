import { Anthropic } from "@anthropic-ai/sdk"
import { expect } from "chai"
import { ContextManager } from "../ContextManager"

describe("ContextManager", () => {
	function createMessages(count: number): Anthropic.Messages.MessageParam[] {
		const messages: Anthropic.Messages.MessageParam[] = []

		messages.push({
			role: "user",
			content: "Initial task message",
		})

		let role: "user" | "assistant" = "assistant"
		for (let i = 1; i < count; i++) {
			messages.push({
				role,
				content: `Message ${i}`,
			})
			role = role === "user" ? "assistant" : "user"
		}

		return messages
	}

	describe("getNextTruncationRange", () => {
		let contextManager: ContextManager

		beforeEach(() => {
			contextManager = new ContextManager()
		})

		it("first truncation with half keep", () => {
			const messages = createMessages(11)
			const result = contextManager.getNextTruncationRange(messages, undefined, "half")

			expect(result).to.deep.equal([2, 5])
		})

		it("first truncation with quarter keep", () => {
			const messages = createMessages(11)
			const result = contextManager.getNextTruncationRange(messages, undefined, "quarter")

			expect(result).to.deep.equal([2, 7])
		})

		it("sequential truncation with half keep", () => {
			const messages = createMessages(21)
			const firstRange = contextManager.getNextTruncationRange(messages, undefined, "half")
			expect(firstRange).to.deep.equal([2, 9])

			// Pass the previous range for sequential truncation
			const secondRange = contextManager.getNextTruncationRange(messages, firstRange, "half")
			expect(secondRange).to.deep.equal([2, 13])
		})

		it("sequential truncation with quarter keep", () => {
			const messages = createMessages(41)
			const firstRange = contextManager.getNextTruncationRange(messages, undefined, "quarter")

			const secondRange = contextManager.getNextTruncationRange(messages, firstRange, "quarter")

			expect(secondRange[0]).to.equal(2)
			expect(secondRange[1]).to.be.greaterThan(firstRange[1])
		})

		it("ensures the last message in range is a user message", () => {
			const messages = createMessages(14)
			const result = contextManager.getNextTruncationRange(messages, undefined, "half")

			// Check if the message at the end of range is an assistant message
			const lastRemovedMessage = messages[result[1]]
			expect(lastRemovedMessage.role).to.equal("assistant")

			// Check if the next message after the range is a user message
			const nextMessage = messages[result[1] + 1]
			expect(nextMessage.role).to.equal("user")
		})

		it("handles small message arrays", () => {
			const messages = createMessages(3)
			const result = contextManager.getNextTruncationRange(messages, undefined, "half")

			expect(result).to.deep.equal([2, 1])
		})

		it("preserves the message structure when truncating", () => {
			const messages = createMessages(20)
			const result = contextManager.getNextTruncationRange(messages, undefined, "half")

			// Get messages after removing the range
			const effectiveMessages = [...messages.slice(0, result[0]), ...messages.slice(result[1] + 1)]

			// Check first message and alternating pattern
			expect(effectiveMessages[0].role).to.equal("user")
			for (let i = 1; i < effectiveMessages.length; i++) {
				const expectedRole = i % 2 === 1 ? "assistant" : "user"
				expect(effectiveMessages[i].role).to.equal(expectedRole)
			}
		})
	})

	describe("getTruncatedMessages", () => {
		let contextManager: ContextManager

		beforeEach(() => {
			contextManager = new ContextManager()
		})

		it("returns original messages when no range is provided", () => {
			const messages = createMessages(3)

			const result = contextManager.getTruncatedMessages(messages, undefined)
			expect(result).to.deep.equal(messages)
		})

		it("correctly removes messages in the specified range", () => {
			const messages = createMessages(5)

			const range: [number, number] = [1, 3]
			const result = contextManager.getTruncatedMessages(messages, range)

			expect(result).to.have.lengthOf(3)
			expect(result[0]).to.deep.equal(messages[0])
			expect(result[1]).to.deep.equal(messages[1])
			expect(result[2]).to.deep.equal(messages[4])
		})

		it("works with a range that starts at the first message after task", () => {
			const messages = createMessages(4)

			const range: [number, number] = [1, 2]
			const result = contextManager.getTruncatedMessages(messages, range)

			expect(result).to.have.lengthOf(3)
			expect(result[0]).to.deep.equal(messages[0])
			expect(result[1]).to.deep.equal(messages[1])
			expect(result[2]).to.deep.equal(messages[3])
		})

		it("correctly handles removing a range while preserving alternation pattern", () => {
			const messages = createMessages(5)

			const range: [number, number] = [2, 3]
			const result = contextManager.getTruncatedMessages(messages, range)

			expect(result).to.have.lengthOf(3)
			expect(result[0]).to.deep.equal(messages[0])
			expect(result[1]).to.deep.equal(messages[1])
			expect(result[2]).to.deep.equal(messages[4])

			expect(result[0].role).to.equal("user")
			expect(result[1].role).to.equal("assistant")
			expect(result[2].role).to.equal("user")
		})

		it("removes orphaned tool_results after truncation", () => {
			// Create messages with tool_use and tool_result blocks
			const messages: Anthropic.Messages.MessageParam[] = [
				{ role: "user", content: "Initial task" },
				{ role: "assistant", content: "Response 1" },
				// Assistant message with tool_use that will be truncated
				{
					role: "assistant",
					content: [
						{ type: "text", text: "Using a tool" },
						{ type: "tool_use", id: "tool_123", name: "read_file", input: { path: "test.ts" } },
					],
				},
				// User message with tool_result - should have tool_result removed after truncation
				{
					role: "user",
					content: [
						{ type: "tool_result", tool_use_id: "tool_123", content: "file content here" },
						{ type: "text", text: "Additional user text" },
					],
				},
				{ role: "assistant", content: "Response 2" },
			]

			// Truncate to remove the assistant message with tool_use
			const range: [number, number] = [2, 2]
			const result = contextManager.getTruncatedMessages(messages, range)

			// Should have 4 messages (original 5 minus 1 truncated)
			expect(result).to.have.lengthOf(4)

			// The user message at index 2 should have tool_result removed but text preserved
			const userMessageAfterTruncation = result[2]
			expect(userMessageAfterTruncation.role).to.equal("user")
			expect(Array.isArray(userMessageAfterTruncation.content)).to.be.true

			const content = userMessageAfterTruncation.content as Anthropic.Messages.ContentBlockParam[]
			// Should only have the text block, not the tool_result
			expect(content).to.have.lengthOf(1)
			expect(content[0].type).to.equal("text")
			expect((content[0] as Anthropic.Messages.TextBlockParam).text).to.equal("Additional user text")
		})
	})

	describe("applyFileReadContextHistoryUpdates", () => {
		let contextManager: ContextManager

		beforeEach(() => {
			contextManager = new ContextManager()
		})

		it("should return early when fileReadIndices is empty", () => {
			const fileReadIndices = new Map<string, [number, number, string, string, number][]>()
			const messageFilePaths = new Map<number, string[]>()
			const apiMessages: Anthropic.Messages.MessageParam[] = []
			const timestamp = Date.now()

			const [didUpdate, updatedIndices] = (contextManager as any).applyFileReadContextHistoryUpdates(
				fileReadIndices,
				messageFilePaths,
				apiMessages,
				timestamp,
			)

			expect(didUpdate).to.be.false
			expect(updatedIndices.size).to.equal(0)
		})

		it("should not update when file has only one occurrence", () => {
			const fileReadIndices = new Map<string, [number, number, string, string, number][]>()
			fileReadIndices.set("test.ts", [[3, 2, "", "replacement text", 0]])

			const messageFilePaths = new Map<number, string[]>()
			const apiMessages: Anthropic.Messages.MessageParam[] = []
			const timestamp = Date.now()

			const [didUpdate, updatedIndices] = (contextManager as any).applyFileReadContextHistoryUpdates(
				fileReadIndices,
				messageFilePaths,
				apiMessages,
				timestamp,
			)

			expect(didUpdate).to.be.false
			expect(updatedIndices.size).to.equal(0)
		})

		it("should update all but the last occurrence of duplicate file reads", () => {
			const fileReadIndices = new Map<string, [number, number, string, string, number][]>()
			// messageIndex, messageType (READ_FILE_TOOL=2), searchText, replaceText, innerIndex
			fileReadIndices.set("test.ts", [
				[3, 2, "", "[read_file for 'test.ts'] Result:\nDuplicate file read...", 0],
				[5, 2, "", "[read_file for 'test.ts'] Result:\nDuplicate file read...", 0],
				[7, 2, "", "[read_file for 'test.ts'] Result:\nKeep this one", 0],
			])

			const messageFilePaths = new Map<number, string[]>()
			const apiMessages: Anthropic.Messages.MessageParam[] = []
			const timestamp = Date.now()

			const [didUpdate, updatedIndices] = (contextManager as any).applyFileReadContextHistoryUpdates(
				fileReadIndices,
				messageFilePaths,
				apiMessages,
				timestamp,
			)

			expect(didUpdate).to.be.true
			expect(updatedIndices.size).to.equal(2)
			expect(updatedIndices.has(3)).to.be.true
			expect(updatedIndices.has(5)).to.be.true
			expect(updatedIndices.has(7)).to.be.false // Last occurrence should not be updated
		})

		it("should handle FILE_MENTION type correctly with multiple files in same text", () => {
			const fileReadIndices = new Map<string, [number, number, string, string, number][]>()
			// FILE_MENTION = 4
			fileReadIndices.set("file1.ts", [
				[
					3,
					4,
					'<file_content path="file1.ts">content1</file_content>',
					'<file_content path="file1.ts">Duplicate file read...</file_content>',
					0,
				],
				[
					5,
					4,
					'<file_content path="file1.ts">content2</file_content>',
					'<file_content path="file1.ts">Keep this</file_content>',
					0,
				],
			])
			fileReadIndices.set("file2.ts", [
				[
					3,
					4,
					'<file_content path="file2.ts">content3</file_content>',
					'<file_content path="file2.ts">Duplicate file read...</file_content>',
					0,
				],
				[
					6,
					4,
					'<file_content path="file2.ts">content4</file_content>',
					'<file_content path="file2.ts">Keep this</file_content>',
					0,
				],
			])

			const messageFilePaths = new Map<number, string[]>()
			messageFilePaths.set(3, ["file1.ts", "file2.ts"])

			const apiMessages: Anthropic.Messages.MessageParam[] = [
				{ role: "user", content: "Initial" },
				{ role: "assistant", content: "Response" },
				{ role: "user", content: "Message" },
				{
					role: "user",
					content: [
						{
							type: "text",
							text: '<file_content path="file1.ts">content1</file_content>\n<file_content path="file2.ts">content3</file_content>',
						},
					],
				},
			]
			const timestamp = Date.now()

			const [didUpdate, updatedIndices] = (contextManager as any).applyFileReadContextHistoryUpdates(
				fileReadIndices,
				messageFilePaths,
				apiMessages,
				timestamp,
			)

			expect(didUpdate).to.be.true
			expect(updatedIndices.size).to.equal(1)
			expect(updatedIndices.has(3)).to.be.true
		})

		it("should handle ALTER_FILE_TOOL type correctly", () => {
			const fileReadIndices = new Map<string, [number, number, string, string, number][]>()
			// ALTER_FILE_TOOL = 3
			fileReadIndices.set("test.ts", [
				[3, 3, "", "replacement text 1", 0],
				[5, 3, "", "replacement text 2", 0],
			])

			const messageFilePaths = new Map<number, string[]>()
			const apiMessages: Anthropic.Messages.MessageParam[] = []
			const timestamp = Date.now()

			const [didUpdate, updatedIndices] = (contextManager as any).applyFileReadContextHistoryUpdates(
				fileReadIndices,
				messageFilePaths,
				apiMessages,
				timestamp,
			)

			expect(didUpdate).to.be.true
			expect(updatedIndices.size).to.equal(1)
			expect(updatedIndices.has(3)).to.be.true
			expect(updatedIndices.has(5)).to.be.false
		})

		it("should handle native tool calling format (tool_result blocks)", () => {
			const fileReadIndices = new Map<string, [number, number, string, string, number][]>()
			fileReadIndices.set("test.ts", [
				[3, 2, "", "[read_file for 'test.ts'] Result:\nDuplicate...", 0],
				[5, 2, "", "[read_file for 'test.ts'] Result:\nKeep this", 0],
			])

			const messageFilePaths = new Map<number, string[]>()
			const apiMessages: Anthropic.Messages.MessageParam[] = [
				{ role: "user", content: "Initial" },
				{ role: "assistant", content: "Response" },
				{ role: "user", content: "Message" },
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool_123",
							content: [{ type: "text", text: "[read_file for 'test.ts'] Result:\noriginal content" }],
						},
					],
				},
			]
			const timestamp = Date.now()

			const [didUpdate, updatedIndices] = (contextManager as any).applyFileReadContextHistoryUpdates(
				fileReadIndices,
				messageFilePaths,
				apiMessages,
				timestamp,
			)

			expect(didUpdate).to.be.true
			expect(updatedIndices.size).to.equal(1)
			expect(updatedIndices.has(3)).to.be.true
		})
	})

	describe("helper methods for applyFileReadContextHistoryUpdates", () => {
		let contextManager: ContextManager

		beforeEach(() => {
			contextManager = new ContextManager()
		})

		it("getBaseTextForFileMention should get text from existing updates", () => {
			const messageIndex = 3
			const innerIndex = 0
			const apiMessages: Anthropic.Messages.MessageParam[] = [
				{ role: "user", content: "Initial" },
				{ role: "assistant", content: "Response" },
				{ role: "user", content: "Message" },
				{ role: "user", content: [{ type: "text", text: "original text" }] },
			]

			// Manually set up context history updates
			const timestamp = Date.now()
			const innerMap = new Map<number, any[]>()
			innerMap.set(innerIndex, [[timestamp, "text", ["updated text"], []]])
			;(contextManager as any).contextHistoryUpdates.set(messageIndex, [4, innerMap])

			const result = (contextManager as any).getBaseTextForFileMention(messageIndex, innerIndex, apiMessages)

			expect(result).to.equal("updated text")
		})

		it("getBaseTextForFileMention should fallback to original message content", () => {
			const messageIndex = 3
			const innerIndex = 0
			const apiMessages: Anthropic.Messages.MessageParam[] = [
				{ role: "user", content: "Initial" },
				{ role: "assistant", content: "Response" },
				{ role: "user", content: "Message" },
				{ role: "user", content: [{ type: "text", text: "original text" }] },
			]

			const result = (contextManager as any).getBaseTextForFileMention(messageIndex, innerIndex, apiMessages)

			expect(result).to.equal("original text")
		})

		it("getBaseTextForFileMention should handle tool_result blocks", () => {
			const messageIndex = 3
			const innerIndex = 0
			const apiMessages: Anthropic.Messages.MessageParam[] = [
				{ role: "user", content: "Initial" },
				{ role: "assistant", content: "Response" },
				{ role: "user", content: "Message" },
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool_123",
							content: [{ type: "text", text: "tool result text" }],
						},
					],
				},
			]

			const result = (contextManager as any).getBaseTextForFileMention(messageIndex, innerIndex, apiMessages)

			expect(result).to.equal("tool result text")
		})

		it("getPreviouslyReplacedFiles should return empty array when no updates exist", () => {
			const messageIndex = 3
			const innerIndex = 0

			const result = (contextManager as any).getPreviouslyReplacedFiles(messageIndex, innerIndex)

			expect(result).to.deep.equal([])
		})

		it("getPreviouslyReplacedFiles should return previously replaced files", () => {
			const messageIndex = 3
			const innerIndex = 0
			const timestamp = Date.now()

			// Manually set up context history updates with metadata
			const innerMap = new Map<number, any[]>()
			innerMap.set(innerIndex, [
				[
					timestamp,
					"text",
					["updated text"],
					[
						["file1.ts", "file2.ts"],
						["file1.ts", "file2.ts", "file3.ts"],
					],
				],
			])
			;(contextManager as any).contextHistoryUpdates.set(messageIndex, [4, innerMap])

			const result = (contextManager as any).getPreviouslyReplacedFiles(messageIndex, innerIndex)

			expect(result).to.deep.equal(["file1.ts", "file2.ts"])
		})

		it("addContextUpdate should create new entry when none exists", () => {
			const messageIndex = 3
			const messageType = 2 // READ_FILE_TOOL
			const innerIndex = 0
			const timestamp = Date.now()
			const messageString = "replacement text"

			;(contextManager as any).addContextUpdate(messageIndex, messageType, innerIndex, timestamp, messageString)

			const contextHistory = (contextManager as any).contextHistoryUpdates
			expect(contextHistory.has(messageIndex)).to.be.true

			const [storedType, innerMap] = contextHistory.get(messageIndex)
			expect(storedType).to.equal(messageType)
			expect(innerMap.has(innerIndex)).to.be.true

			const updates = innerMap.get(innerIndex)
			expect(updates).to.have.lengthOf(1)
			expect(updates[0]).to.deep.equal([timestamp, "text", [messageString], []])
		})

		it("addContextUpdate should append to existing updates", () => {
			const messageIndex = 3
			const messageType = 2
			const innerIndex = 0
			const timestamp1 = Date.now()
			const timestamp2 = timestamp1 + 1000

			;(contextManager as any).addContextUpdate(messageIndex, messageType, innerIndex, timestamp1, "first update")
			;(contextManager as any).addContextUpdate(messageIndex, messageType, innerIndex, timestamp2, "second update")

			const contextHistory = (contextManager as any).contextHistoryUpdates
			const [, innerMap] = contextHistory.get(messageIndex)
			const updates = innerMap.get(innerIndex)

			expect(updates).to.have.lengthOf(2)
			expect(updates[1]).to.deep.equal([timestamp2, "text", ["second update"], []])
		})

		it("getOrCreateInnerMap should return existing map", () => {
			const messageIndex = 3
			const messageType = 2
			const innerMap = new Map<number, any[]>()
			;(contextManager as any).contextHistoryUpdates.set(messageIndex, [messageType, innerMap])

			const result = (contextManager as any).getOrCreateInnerMap(messageIndex, messageType)

			expect(result).to.equal(innerMap)
		})

		it("getOrCreateInnerMap should create new map when none exists", () => {
			const messageIndex = 3
			const messageType = 2

			const result = (contextManager as any).getOrCreateInnerMap(messageIndex, messageType)

			expect(result).to.be.instanceOf(Map)
			const contextHistory = (contextManager as any).contextHistoryUpdates
			expect(contextHistory.has(messageIndex)).to.be.true

			const [storedType, storedMap] = contextHistory.get(messageIndex)
			expect(storedType).to.equal(messageType)
			expect(storedMap).to.equal(result)
		})
	})
})
