// npx vitest src/core/condense/__tests__/condense.spec.ts

import { Anthropic } from "@anthropic-ai/sdk"
import type { ModelInfo } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { BaseProvider } from "../../../api/providers/base-provider"
import { ApiMessage } from "../../task-persistence/apiMessages"
import { summarizeConversation, getMessagesSinceLastSummary, N_MESSAGES_TO_KEEP } from "../index"

// Create a mock ApiHandler for testing
class MockApiHandler extends BaseProvider {
	createMessage(): any {
		// Mock implementation for testing - returns an async iterable stream
		const mockStream = {
			async *[Symbol.asyncIterator]() {
				yield { type: "text", text: "Mock summary of the conversation" }
				yield { type: "usage", inputTokens: 100, outputTokens: 50, totalCost: 0.01 }
			},
		}
		return mockStream
	}

	getModel(): { id: string; info: ModelInfo } {
		return {
			id: "test-model",
			info: {
				contextWindow: 100000,
				maxTokens: 50000,
				supportsPromptCache: true,
				supportsImages: false,
				inputPrice: 0,
				outputPrice: 0,
				description: "Test model",
			},
		}
	}

	override async countTokens(content: Array<Anthropic.Messages.ContentBlockParam>): Promise<number> {
		// Simple token counting for testing
		let tokens = 0
		for (const block of content) {
			if (block.type === "text") {
				tokens += Math.ceil(block.text.length / 4) // Rough approximation
			}
		}
		return tokens
	}
}

const mockApiHandler = new MockApiHandler()
const taskId = "test-task-id"

describe("Condense", () => {
	beforeEach(() => {
		if (!TelemetryService.hasInstance()) {
			TelemetryService.createInstance([])
		}
	})

	describe("summarizeConversation", () => {
		it("should preserve the first message when summarizing", async () => {
			const messages: ApiMessage[] = [
				{ role: "user", content: "First message with /prr command content" },
				{ role: "assistant", content: "Second message" },
				{ role: "user", content: "Third message" },
				{ role: "assistant", content: "Fourth message" },
				{ role: "user", content: "Fifth message" },
				{ role: "assistant", content: "Sixth message" },
				{ role: "user", content: "Seventh message" },
				{ role: "assistant", content: "Eighth message" },
				{ role: "user", content: "Ninth message" },
			]

			const result = await summarizeConversation(messages, mockApiHandler, "System prompt", taskId, 5000, false)

			// Verify the first message is preserved
			expect(result.messages[0]).toEqual(messages[0])
			expect(result.messages[0].content).toBe("First message with /prr command content")

			// Verify we have a summary message
			const summaryMessage = result.messages.find((msg) => msg.isSummary)
			expect(summaryMessage).toBeTruthy()
			expect(summaryMessage?.content).toBe("Mock summary of the conversation")

			// Verify we have the expected number of messages
			// [first message, summary, last N messages]
			expect(result.messages.length).toBe(1 + 1 + N_MESSAGES_TO_KEEP)

			// Verify the last N messages are preserved
			const lastMessages = result.messages.slice(-N_MESSAGES_TO_KEEP)
			expect(lastMessages).toEqual(messages.slice(-N_MESSAGES_TO_KEEP))
		})

		it("should preserve slash command content in the first message", async () => {
			const slashCommandContent = "/prr #123 - Fix authentication bug"
			const messages: ApiMessage[] = [
				{ role: "user", content: slashCommandContent },
				{ role: "assistant", content: "I'll help you fix that authentication bug" },
				{ role: "user", content: "The issue is with JWT tokens" },
				{ role: "assistant", content: "Let me examine the JWT implementation" },
				{ role: "user", content: "It's failing on refresh" },
				{ role: "assistant", content: "I found the issue" },
				{ role: "user", content: "Great, can you fix it?" },
				{ role: "assistant", content: "Here's the fix" },
				{ role: "user", content: "Thanks!" },
			]

			const result = await summarizeConversation(messages, mockApiHandler, "System prompt", taskId, 5000, false)

			// The first message with slash command should be intact
			expect(result.messages[0].content).toBe(slashCommandContent)
			expect(result.messages[0]).toEqual(messages[0])
		})

		it("should handle complex first message content", async () => {
			const complexContent: Anthropic.Messages.ContentBlockParam[] = [
				{ type: "text", text: "/mode code" },
				{ type: "text", text: "Additional context from the user" },
			]

			const messages: ApiMessage[] = [
				{ role: "user", content: complexContent },
				{ role: "assistant", content: "Switching to code mode" },
				{ role: "user", content: "Write a function" },
				{ role: "assistant", content: "Here's the function" },
				{ role: "user", content: "Add error handling" },
				{ role: "assistant", content: "Added error handling" },
				{ role: "user", content: "Add tests" },
				{ role: "assistant", content: "Tests added" },
				{ role: "user", content: "Perfect!" },
			]

			const result = await summarizeConversation(messages, mockApiHandler, "System prompt", taskId, 5000, false)

			// The first message with complex content should be preserved
			expect(result.messages[0].content).toEqual(complexContent)
			expect(result.messages[0]).toEqual(messages[0])
		})

		it("should return error when not enough messages to summarize", async () => {
			const messages: ApiMessage[] = [
				{ role: "user", content: "First message with /command" },
				{ role: "assistant", content: "Second message" },
				{ role: "user", content: "Third message" },
				{ role: "assistant", content: "Fourth message" },
			]

			const result = await summarizeConversation(messages, mockApiHandler, "System prompt", taskId, 5000, false)

			// Should return an error since we have only 4 messages (first + 3 to keep)
			expect(result.error).toBeDefined()
			expect(result.messages).toEqual(messages) // Original messages unchanged
			expect(result.summary).toBe("")
		})

		it("should not summarize messages that already contain a recent summary", async () => {
			const messages: ApiMessage[] = [
				{ role: "user", content: "First message with /command" },
				{ role: "assistant", content: "Old message" },
				{ role: "user", content: "Message before summary" },
				{ role: "assistant", content: "Response" },
				{ role: "user", content: "Another message" },
				{ role: "assistant", content: "Previous summary", isSummary: true }, // Summary in last N messages
				{ role: "user", content: "Final message" },
			]

			const result = await summarizeConversation(messages, mockApiHandler, "System prompt", taskId, 5000, false)

			// Should return an error due to recent summary in last N messages
			expect(result.error).toBeDefined()
			expect(result.messages).toEqual(messages)
			expect(result.summary).toBe("")
		})

		it("should handle empty summary from API gracefully", async () => {
			// Mock handler that returns empty summary
			class EmptyMockApiHandler extends MockApiHandler {
				override createMessage(): any {
					const mockStream = {
						async *[Symbol.asyncIterator]() {
							yield { type: "text", text: "" }
							yield { type: "usage", inputTokens: 100, outputTokens: 0, totalCost: 0.01 }
						},
					}
					return mockStream
				}
			}

			const emptyHandler = new EmptyMockApiHandler()
			const messages: ApiMessage[] = [
				{ role: "user", content: "First message" },
				{ role: "assistant", content: "Second" },
				{ role: "user", content: "Third" },
				{ role: "assistant", content: "Fourth" },
				{ role: "user", content: "Fifth" },
				{ role: "assistant", content: "Sixth" },
				{ role: "user", content: "Seventh" },
			]

			const result = await summarizeConversation(messages, emptyHandler, "System prompt", taskId, 5000, false)

			expect(result.error).toBeDefined()
			expect(result.messages).toEqual(messages)
			expect(result.cost).toBeGreaterThan(0)
		})
	})

	describe("getMessagesSinceLastSummary", () => {
		it("should return all messages when no summary exists", () => {
			const messages: ApiMessage[] = [
				{ role: "user", content: "First message" },
				{ role: "assistant", content: "Second message" },
				{ role: "user", content: "Third message" },
			]

			const result = getMessagesSinceLastSummary(messages)
			expect(result).toEqual(messages)
		})

		it("should return messages since last summary including the summary", () => {
			const messages: ApiMessage[] = [
				{ role: "user", content: "First message" },
				{ role: "assistant", content: "Second message" },
				{ role: "assistant", content: "Summary content", isSummary: true },
				{ role: "user", content: "Message after summary" },
				{ role: "assistant", content: "Final message" },
			]

			const result = getMessagesSinceLastSummary(messages)

			// Should include the original first user message for context preservation, the summary, and messages after
			expect(result[0].role).toBe("user")
			expect(result[0].content).toBe("First message") // Preserves original first message
			expect(result[1]).toEqual(messages[2]) // The summary
			expect(result[2]).toEqual(messages[3])
			expect(result[3]).toEqual(messages[4])
		})

		it("should handle multiple summaries and return from the last one", () => {
			const messages: ApiMessage[] = [
				{ role: "user", content: "First message" },
				{ role: "assistant", content: "First summary", isSummary: true },
				{ role: "user", content: "Middle message" },
				{ role: "assistant", content: "Second summary", isSummary: true },
				{ role: "user", content: "Recent message" },
				{ role: "assistant", content: "Final message" },
			]

			const result = getMessagesSinceLastSummary(messages)

			// Should only include from the last summary with original first message preserved
			expect(result[0].role).toBe("user")
			expect(result[0].content).toBe("First message") // Preserves original first message
			expect(result[1]).toEqual(messages[3]) // Second summary
			expect(result[2]).toEqual(messages[4])
			expect(result[3]).toEqual(messages[5])
		})
	})
})
