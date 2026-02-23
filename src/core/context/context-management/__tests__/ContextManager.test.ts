import { Anthropic } from "@anthropic-ai/sdk"
import { ClineMessage } from "@shared/ExtensionMessage"
import { expect } from "chai"
import { ContextManager } from "../ContextManager"
import { getEffectiveCompactionThreshold } from "../context-window-utils"

// Minimal mock for ApiHandler — only getModel().info.contextWindow is used by shouldCompactContextWindow
function createMockApi(contextWindow: number) {
	return {
		getModel: () => ({ id: "test-model", info: { contextWindow } }),
	} as any
}

function createApiReqMessage(tokens: {
	tokensIn?: number
	tokensOut?: number
	cacheWrites?: number
	cacheReads?: number
}): ClineMessage {
	return {
		ts: Date.now(),
		type: "say",
		say: "api_req_started",
		text: JSON.stringify(tokens),
	}
}

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

	describe("applyContextOptimizations", () => {
		let contextManager: ContextManager

		beforeEach(() => {
			contextManager = new ContextManager()
		})

		it("detects duplicate file reads across write_to_file, replace_in_file, and file mentions (normal tool calling)", () => {
			const messages: Anthropic.Messages.MessageParam[] = [
				{ role: "user", content: "Initial task" },
				{ role: "assistant", content: "Response" },
				{
					role: "user",
					content: [
						{
							type: "text",
							text: "[write_to_file for 'test.txt'] Result:\nThe content was successfully saved to test.txt.\n\nHere is the full, updated content of the file that was saved:\n\n<final_file_content path=\"test.txt\">\ntest\n\n</final_file_content>",
						},
						{
							type: "text",
							text: "<environment_details>\n# Visual Studio Code Visible Files\ntest.txt\n\n# Current Mode\nACT MODE\n</environment_details>",
						},
					],
				},
				{ role: "assistant", content: "Response" },
				{
					role: "user",
					content: [
						{
							type: "text",
							text: "[replace_in_file for 'test.txt'] Result:\nThe content was successfully saved to test.txt.\n\nHere is the full, updated content of the file that was saved:\n\n<final_file_content path=\"test.txt\">\ntest 2\n\n</final_file_content>",
						},
						{
							type: "text",
							text: "<environment_details>\n# Visual Studio Code Visible Files\ntest.txt\n\n# Current Mode\nACT MODE\n</environment_details>",
						},
					],
				},
				{ role: "assistant", content: "Response" },
				{
					role: "user",
					content: [
						{
							type: "text",
							text: "[TASK RESUMPTION] This task was interrupted just now. The conversation may have been incomplete.",
						},
						{
							type: "text",
							text: "New message to respond to:\n<user_message>\n'test.txt' (see below for file content) tell me whats in this file\n</user_message>\n\n<file_content path=\"test.txt\">\ntest 2\n\n</file_content>",
						},
					],
				},
			]

			const timestamp = Date.now()
			const [didUpdate, indices] = contextManager.applyContextOptimizations(messages, 2, timestamp)

			expect(didUpdate).to.equal(true)
			expect(indices.size).to.equal(2)
			expect(indices.has(2)).to.equal(true)
			expect(indices.has(4)).to.equal(true)
			expect(indices.has(6)).to.equal(false)
		})

		it("returns false when no duplicate file reads exist", () => {
			const messages: Anthropic.Messages.MessageParam[] = [
				{ role: "user", content: "Initial task" },
				{ role: "assistant", content: "Response" },
				{
					role: "user",
					content: [
						{
							type: "text",
							text: "[write_to_file for 'test.txt'] Result:\n<final_file_content path=\"test.txt\">\ntest\n\n</final_file_content>",
						},
					],
				},
				{ role: "assistant", content: "Response" },
				{
					role: "user",
					content: [
						{
							type: "text",
							text: "[write_to_file for 'other.txt'] Result:\n<final_file_content path=\"other.txt\">\nother content\n\n</final_file_content>",
						},
					],
				},
			]

			const [didUpdate, indices] = contextManager.applyContextOptimizations(messages, 2, Date.now())

			expect(didUpdate).to.equal(false)
			expect(indices.size).to.equal(0)
		})

		it("returns false for empty messages beyond startFromIndex", () => {
			const messages: Anthropic.Messages.MessageParam[] = [
				{ role: "user", content: "Initial task" },
				{ role: "assistant", content: "Response" },
			]

			const [didUpdate, indices] = contextManager.applyContextOptimizations(messages, 2, Date.now())

			expect(didUpdate).to.equal(false)
			expect(indices.size).to.equal(0)
		})

		it("detects duplicate file reads with native tool calling format (tool_result blocks)", () => {
			const messages: Anthropic.Messages.MessageParam[] = [
				{ role: "user", content: "Initial task" },
				{ role: "assistant", content: [{ type: "tool_use", id: "toolu_001", name: "plan_mode_respond", input: {} }] },
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "toolu_001",
							content: [
								{
									type: "text",
									text: "[plan_mode_respond] Result:\n<user_message>\n'test2.txt' (see below for file content)\n</user_message>\n\n<file_content path=\"/Users/toshi/Desktop/cline_testing_repo/test2.txt\">\ntest\n\n</file_content>",
								},
							],
						},
					],
				},
				{ role: "assistant", content: [{ type: "tool_use", id: "toolu_002", name: "write_to_file", input: {} }] },
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "toolu_002",
							content: [
								{
									type: "text",
									text: "[write_to_file for '/Users/toshi/Desktop/cline_testing_repo/test2.txt'] Result:\nThe content was successfully saved.\n\n<final_file_content path=\"/Users/toshi/Desktop/cline_testing_repo/test2.txt\">\ntest\n\n</final_file_content>",
								},
							],
						},
						{ type: "text", text: "<environment_details>\n# Current Mode\nACT MODE\n</environment_details>" },
					],
				},
				{ role: "assistant", content: [{ type: "tool_use", id: "toolu_003", name: "text", input: {} }] },
				{
					role: "user",
					content: [
						{
							type: "text",
							text: "[TASK RESUMPTION] This task was interrupted just now. The conversation may have been incomplete.",
						},
						{ type: "text", text: "New message to respond to with plan_mode_respond tool" },
					],
				},
				{ role: "assistant", content: [{ type: "tool_use", id: "toolu_004", name: "replace_in_file", input: {} }] },
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "toolu_004",
							content: [
								{
									type: "text",
									text: "[replace_in_file for '/Users/toshi/Desktop/cline_testing_repo/test2.txt'] Result:\nThe content was successfully saved.\n\n<final_file_content path=\"/Users/toshi/Desktop/cline_testing_repo/test2.txt\">\ntest2\n\n</final_file_content>",
								},
							],
						},
						{ type: "text", text: "<environment_details>\n# Current Mode\nACT MODE\n</environment_details>" },
					],
				},
			]

			const timestamp = Date.now()
			const [didUpdate, indices] = contextManager.applyContextOptimizations(messages, 2, timestamp)

			expect(didUpdate).to.equal(true)
			expect(indices.size).to.equal(2)
			expect(indices.has(2)).to.equal(true)
			expect(indices.has(4)).to.equal(true)
			expect(indices.has(8)).to.equal(false)
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

	describe("shouldCompactContextWindow", () => {
		let contextManager: ContextManager

		beforeEach(() => {
			contextManager = new ContextManager()
		})

		// --- Default behavior (no custom token limit) ---

		it("does not compact at 33K tokens when default threshold is used on 200K context", () => {
			// 200K model: maxAllowedSize = 200K - 40K = 160K
			// 33K << 160K so no compaction
			const api = createMockApi(200_000)
			const clineMessages: ClineMessage[] = [createApiReqMessage({ tokensIn: 30_000, tokensOut: 3_000 })]

			const result = contextManager.shouldCompactContextWindow(clineMessages, api, 0, undefined)
			expect(result).to.equal(false)
		})

		it("compacts when tokens exceed maxAllowedSize on 200K context (default behavior)", () => {
			// 200K model: maxAllowedSize = 160K; send 165K tokens
			const api = createMockApi(200_000)
			const clineMessages: ClineMessage[] = [createApiReqMessage({ tokensIn: 155_000, tokensOut: 10_000 })]

			const result = contextManager.shouldCompactContextWindow(clineMessages, api, 0, undefined)
			expect(result).to.equal(true)
		})

		it("falls back to maxAllowedSize when customTokenLimit is undefined", () => {
			// 200K model: maxAllowedSize = 160K; 155K < 160K → no compaction
			const api = createMockApi(200_000)
			const clineMessages: ClineMessage[] = [createApiReqMessage({ tokensIn: 150_000, tokensOut: 5_000 })]

			const result = contextManager.shouldCompactContextWindow(clineMessages, api, 0, undefined)
			expect(result).to.equal(false)
		})

		it("falls back to maxAllowedSize when customTokenLimit is 0", () => {
			// 0 is treated as "no custom limit" — falls back to maxAllowedSize (160K)
			const api = createMockApi(200_000)
			const clineMessages: ClineMessage[] = [createApiReqMessage({ tokensIn: 150_000, tokensOut: 5_000 })]

			const result = contextManager.shouldCompactContextWindow(clineMessages, api, 0, 0)
			expect(result).to.equal(false)
		})

		// --- Custom token limit behavior (autoCondenseTokenLimit) ---

		it("compacts earlier when customTokenLimit is set below maxAllowedSize", () => {
			// 200K model: maxAllowedSize = 160K; customTokenLimit = 100K
			// Effective threshold = min(100K, 160K) = 100K
			// Send 110K tokens → should compact
			const api = createMockApi(200_000)
			const clineMessages: ClineMessage[] = [createApiReqMessage({ tokensIn: 100_000, tokensOut: 10_000 })]

			const result = contextManager.shouldCompactContextWindow(clineMessages, api, 0, 100_000)
			expect(result).to.equal(true)
		})

		it("does not compact when tokens are below customTokenLimit", () => {
			// 200K model: maxAllowedSize = 160K; customTokenLimit = 100K
			// Send only 80K tokens → should NOT compact
			const api = createMockApi(200_000)
			const clineMessages: ClineMessage[] = [createApiReqMessage({ tokensIn: 75_000, tokensOut: 5_000 })]

			const result = contextManager.shouldCompactContextWindow(clineMessages, api, 0, 100_000)
			expect(result).to.equal(false)
		})

		it("customTokenLimit is capped at maxAllowedSize to preserve safety buffer", () => {
			// 200K model: maxAllowedSize = 160K; customTokenLimit = 300K (exceeds maxAllowedSize)
			// Effective threshold = min(300K, 160K) = 160K
			// Send 165K tokens → should compact
			const api = createMockApi(200_000)
			const clineMessages: ClineMessage[] = [createApiReqMessage({ tokensIn: 165_000 })]

			const result = contextManager.shouldCompactContextWindow(clineMessages, api, 0, 300_000)
			expect(result).to.equal(true)
		})

		it("very large customTokenLimit still respects safety buffer", () => {
			// Even setting customTokenLimit to 1M on a 200K model, threshold is capped at 160K
			const api = createMockApi(200_000)
			const clineMessages: ClineMessage[] = [createApiReqMessage({ tokensIn: 155_000 })]

			// 155K < 160K (maxAllowedSize) → false even with huge customTokenLimit
			const result = contextManager.shouldCompactContextWindow(clineMessages, api, 0, 1_000_000)
			expect(result).to.equal(false)
		})

		it("compacts a 1M context model at 300K custom limit instead of the natural ~750K threshold", () => {
			// Primary use case: 1M context model with early compaction
			// Natural threshold for 1M model: max(1M - 40K, 1M * 0.8) = ~960K
			// With customTokenLimit = 300K: effective = min(300K, ~960K) = 300K
			const api = createMockApi(1_000_000)
			const clineMessages: ClineMessage[] = [createApiReqMessage({ tokensIn: 280_000, tokensOut: 25_000 })]

			const withoutLimit = contextManager.shouldCompactContextWindow(clineMessages, api, 0, undefined)
			const withLimit = contextManager.shouldCompactContextWindow(clineMessages, api, 0, 300_000)

			// Without limit: 305K < 960K → no compaction
			expect(withoutLimit).to.equal(false)
			// With custom 300K limit: 305K >= 300K → compaction triggered
			expect(withLimit).to.equal(true)
		})

		// --- Other behaviors ---

		it("includes cacheWrites and cacheReads in total token count", () => {
			// 200K model: maxAllowedSize = 160K; customTokenLimit = 150K
			// Direct tokens: 5.5K, but cacheReads = 150K → total = 155.5K > 150K → compact
			const api = createMockApi(200_000)
			const clineMessages: ClineMessage[] = [
				createApiReqMessage({ tokensIn: 5_000, tokensOut: 500, cacheWrites: 0, cacheReads: 150_000 }),
			]

			const result = contextManager.shouldCompactContextWindow(clineMessages, api, 0, 150_000)
			expect(result).to.equal(true)
		})

		it("returns false when previousApiReqIndex is negative", () => {
			const api = createMockApi(200_000)
			const clineMessages: ClineMessage[] = [createApiReqMessage({ tokensIn: 200_000 })]

			const result = contextManager.shouldCompactContextWindow(clineMessages, api, -1, undefined)
			expect(result).to.equal(false)
		})
	})

	describe("getEffectiveCompactionThreshold", () => {
		it("returns maxAllowedSize when customTokenLimit is undefined", () => {
			// 200K model: maxAllowedSize = 200K - 40K = 160K
			const api = createMockApi(200_000)
			const result = getEffectiveCompactionThreshold(api, undefined)
			expect(result).to.equal(160_000)
		})

		it("returns maxAllowedSize when customTokenLimit is 0 (treated as no limit)", () => {
			const api = createMockApi(200_000)
			const result = getEffectiveCompactionThreshold(api, 0)
			expect(result).to.equal(160_000)
		})

		it("returns customTokenLimit when it is positive and below maxAllowedSize", () => {
			const api = createMockApi(200_000)
			const result = getEffectiveCompactionThreshold(api, 100_000)
			expect(result).to.equal(100_000)
		})

		it("caps customTokenLimit at maxAllowedSize when it exceeds the safety buffer", () => {
			// 200K model: maxAllowedSize = 160K; customTokenLimit = 250K → capped at 160K
			const api = createMockApi(200_000)
			const result = getEffectiveCompactionThreshold(api, 250_000)
			expect(result).to.equal(160_000)
		})

		it("allows setting a much earlier threshold on 1M context models", () => {
			// 1M model: maxAllowedSize = max(1M - 40K, 1M * 0.8) = 960K
			const api = createMockApi(1_000_000)
			const result = getEffectiveCompactionThreshold(api, 300_000)
			// min(300K, 960K) = 300K
			expect(result).to.equal(300_000)
		})

		it("returns correct maxAllowedSize for 128K model without custom limit", () => {
			// 128K model: maxAllowedSize = 128K - 30K = 98K
			const api = createMockApi(128_000)
			const result = getEffectiveCompactionThreshold(api, undefined)
			expect(result).to.equal(98_000)
		})

		it("customTokenLimit at exact boundary equals maxAllowedSize", () => {
			// Set customTokenLimit exactly at maxAllowedSize — should be returned as-is
			const api = createMockApi(200_000)
			const maxAllowedSize = 160_000
			const result = getEffectiveCompactionThreshold(api, maxAllowedSize)
			expect(result).to.equal(maxAllowedSize)
		})
	})
})
