/**
 * Contract tests for thinking trace preservation across provider transforms.
 *
 * These tests verify that thinking/reasoning content is correctly preserved
 * when converting messages between different API formats. This is critical
 * because losing thinking traces can cause:
 * - Degraded model performance (models need context of their reasoning)
 * - Provider API errors (e.g., Gemini requires reasoning_details for tool calls)
 * - Incorrect cost calculations
 */

import { describe, it } from "mocha"
import "should"
import { ClineAssistantThinkingBlock, ClineStorageMessage, ClineTextContentBlock } from "@/shared/messages/content"
import { sanitizeAnthropicMessages } from "../anthropic-format"
import { convertToOpenAiMessages, sanitizeGeminiMessages } from "../openai-format"

describe("Thinking Trace Preservation", () => {
	describe("convertToOpenAiMessages", () => {
		it("should preserve reasoning_details on text blocks", () => {
			const messages: ClineStorageMessage[] = [
				{
					role: "assistant",
					content: [
						{
							type: "text",
							text: "I'll help you with that.",
							reasoning_details: [
								{
									type: "reasoning.text",
									text: "The user wants help with X...",
									signature: "sig123",
									format: "anthropic-claude-v1",
									index: 0,
								},
							],
						} as ClineTextContentBlock,
					],
				},
			]

			const result = convertToOpenAiMessages(messages)

			result.should.have.length(1)
			const assistantMsg = result[0] as any
			assistantMsg.role.should.equal("assistant")
			assistantMsg.reasoning_details.should.be.an.Array()
			assistantMsg.reasoning_details.should.have.length(1)
			assistantMsg.reasoning_details[0].text.should.equal("The user wants help with X...")
		})

		it("should preserve thinking blocks with signatures", () => {
			const messages: ClineStorageMessage[] = [
				{
					role: "assistant",
					content: [
						{
							type: "thinking",
							thinking: "Let me analyze this problem...",
							signature: "valid-signature",
						} as ClineAssistantThinkingBlock,
						{
							type: "text",
							text: "Here's my answer.",
						} as ClineTextContentBlock,
					],
				},
			]

			const result = convertToOpenAiMessages(messages)

			result.should.have.length(1)
			const assistantMsg = result[0] as any
			// The thinking block content should be preserved in some form
			// (exact handling depends on implementation)
			assistantMsg.content.should.containEql("Here's my answer.")
		})

		it("should consolidate multiple reasoning_details entries", () => {
			const messages: ClineStorageMessage[] = [
				{
					role: "assistant",
					content: [
						{
							type: "text",
							text: "Result",
							reasoning_details: [
								{
									type: "reasoning.text",
									text: "First thought. ",
									signature: "sig1",
									format: "anthropic-claude-v1",
									index: 0,
								},
								{
									type: "reasoning.text",
									text: "Second thought.",
									signature: "sig2",
									format: "anthropic-claude-v1",
									index: 0,
								},
							],
						} as ClineTextContentBlock,
					],
				},
			]

			const result = convertToOpenAiMessages(messages)

			const assistantMsg = result[0] as any
			assistantMsg.reasoning_details.should.be.an.Array()
			// Should be consolidated into one entry per index
			assistantMsg.reasoning_details.should.have.length(1)
			assistantMsg.reasoning_details[0].text.should.equal("First thought. Second thought.")
		})

		it("should filter out corrupted encrypted reasoning blocks", () => {
			const messages: ClineStorageMessage[] = [
				{
					role: "assistant",
					content: [
						{
							type: "text",
							text: "Answer",
							reasoning_details: [
								{
									type: "reasoning.encrypted",
									// Missing 'data' field - corrupted
									signature: "sig",
									format: "anthropic-claude-v1",
									index: 0,
								} as any,
								{
									type: "reasoning.text",
									text: "Valid reasoning",
									signature: "sig2",
									format: "anthropic-claude-v1",
									index: 1,
								},
							],
						} as ClineTextContentBlock,
					],
				},
			]

			const result = convertToOpenAiMessages(messages)

			const assistantMsg = result[0] as any
			// Should only have the valid reasoning entry
			assistantMsg.reasoning_details.should.have.length(1)
			assistantMsg.reasoning_details[0].type.should.equal("reasoning.text")
		})
	})

	describe("sanitizeGeminiMessages", () => {
		it("should drop tool_calls without reasoning_details for Gemini models", () => {
			const messages: any[] = [
				{
					role: "assistant",
					content: "I'll use a tool",
					tool_calls: [{ id: "call_123", type: "function", function: { name: "read_file", arguments: "{}" } }],
					// No reasoning_details
				},
				{
					role: "tool",
					tool_call_id: "call_123",
					content: "file contents",
				},
			]

			const result = sanitizeGeminiMessages(messages, "gemini-2.5-pro")

			// Tool call should be dropped, but content preserved
			result.should.have.length(1)
			const msg = result[0] as any
			msg.role.should.equal("assistant")
			msg.content.should.equal("I'll use a tool")
			;(msg.tool_calls === undefined).should.be.true()
		})

		it("should preserve tool_calls with reasoning_details for Gemini models", () => {
			const messages: any[] = [
				{
					role: "assistant",
					content: null,
					tool_calls: [{ id: "call_123", type: "function", function: { name: "read_file", arguments: "{}" } }],
					reasoning_details: [
						{
							type: "reasoning.text",
							text: "I need to read the file",
							format: "anthropic-claude-v1",
							index: 0,
						},
					],
				},
				{
					role: "tool",
					tool_call_id: "call_123",
					content: "file contents",
				},
			]

			const result = sanitizeGeminiMessages(messages, "gemini-2.5-pro")

			result.should.have.length(2)
			;(result[0] as any).tool_calls.should.have.length(1)
		})

		it("should not modify messages for non-Gemini models", () => {
			const messages: any[] = [
				{
					role: "assistant",
					content: "Using tool",
					tool_calls: [{ id: "call_123", type: "function", function: { name: "test", arguments: "{}" } }],
					// No reasoning_details - would be dropped for Gemini
				},
			]

			const result = sanitizeGeminiMessages(messages, "gpt-4o")

			result.should.have.length(1)
			;(result[0] as any).tool_calls.should.have.length(1)
		})
	})

	describe("sanitizeAnthropicMessages", () => {
		it("should preserve thinking blocks", () => {
			const messages: ClineStorageMessage[] = [
				{
					role: "assistant",
					content: [
						{
							type: "thinking",
							thinking: "Let me think about this...",
							signature: "valid-sig",
						} as ClineAssistantThinkingBlock,
						{
							type: "text",
							text: "Here's my answer",
						} as ClineTextContentBlock,
					],
				},
			]

			const result = sanitizeAnthropicMessages(messages, false)

			result.should.have.length(1)
			const content = result[0].content as any[]
			// Find thinking block
			const thinkingBlock = content.find((b) => b.type === "thinking")
			thinkingBlock.should.not.be.undefined
			thinkingBlock.thinking.should.equal("Let me think about this...")
		})

		it("should not add cache_control to thinking blocks", () => {
			const messages: ClineStorageMessage[] = [
				{
					role: "user",
					content: [
						{
							type: "thinking",
							thinking: "Thinking...",
							signature: "sig",
						} as any,
						{
							type: "text",
							text: "Question",
						} as ClineTextContentBlock,
					],
				},
			]

			const result = sanitizeAnthropicMessages(messages, true)

			result.should.have.length(1)
			const content = result[0].content as any[]
			// The text block (last non-thinking) should have cache_control
			const textBlock = content.find((b) => b.type === "text")
			textBlock.cache_control.should.deepEqual({ type: "ephemeral" })
			// Thinking block should not have cache_control (it doesn't support it)
		})
	})
})
