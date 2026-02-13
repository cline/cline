/**
 * Contract tests for tool call parsing and transformation.
 *
 * These tests verify that tool calls are correctly parsed and transformed
 * between different API formats (Anthropic, OpenAI, etc.). This is critical
 * because incorrect tool parsing can cause:
 * - Tool calls not being executed
 * - Mismatched tool_call_id causing API errors
 * - Lost tool results breaking conversation flow
 */

import { describe, it } from "mocha"
import "should"
import OpenAI from "openai"
import {
	ClineAssistantToolUseBlock,
	ClineStorageMessage,
	ClineTextContentBlock,
	ClineUserToolResultContentBlock,
} from "@/shared/messages/content"
import { convertToAnthropicMessage, convertToOpenAiMessages } from "../openai-format"

describe("Tool Call Parsing", () => {
	describe("convertToOpenAiMessages - Tool Calls", () => {
		it("should convert Anthropic tool_use to OpenAI tool_calls format", () => {
			const messages: ClineStorageMessage[] = [
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_abc123",
							name: "read_file",
							input: { path: "/test/file.ts" },
						} as ClineAssistantToolUseBlock,
					],
				},
			]

			const result = convertToOpenAiMessages(messages)

			result.should.have.length(1)
			const msg = result[0] as any
			msg.role.should.equal("assistant")
			msg.tool_calls.should.have.length(1)
			msg.tool_calls[0].type.should.equal("function")
			msg.tool_calls[0].function.name.should.equal("read_file")
			JSON.parse(msg.tool_calls[0].function.arguments).should.deepEqual({ path: "/test/file.ts" })
		})

		it("should truncate long tool IDs to 40 characters", () => {
			const longId = "a".repeat(50)
			const messages: ClineStorageMessage[] = [
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: longId,
							name: "test_tool",
							input: {},
						} as ClineAssistantToolUseBlock,
					],
				},
			]

			const result = convertToOpenAiMessages(messages)

			const msg = result[0] as any
			msg.tool_calls[0].id.length.should.be.belowOrEqual(40)
		})

		it("should transform OpenAI Responses API tool IDs (fc_ prefix)", () => {
			// OpenAI Responses API uses fc_ prefix with 53 char length
			const responsesApiId = "fc_" + "x".repeat(50)
			const messages: ClineStorageMessage[] = [
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: responsesApiId,
							name: "test_tool",
							input: {},
						} as ClineAssistantToolUseBlock,
					],
				},
			]

			const result = convertToOpenAiMessages(messages)

			const msg = result[0] as any
			// Should be transformed to call_ prefix format
			msg.tool_calls[0].id.should.startWith("call_")
			msg.tool_calls[0].id.length.should.be.belowOrEqual(40)
		})

		it("should match tool_call_id with tool_calls id for tool results", () => {
			const toolId = "toolu_abc123"
			const messages: ClineStorageMessage[] = [
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: toolId,
							name: "read_file",
							input: { path: "/test.ts" },
						} as ClineAssistantToolUseBlock,
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: toolId,
							content: "file contents here",
						} as ClineUserToolResultContentBlock,
					],
				},
			]

			const result = convertToOpenAiMessages(messages)

			result.should.have.length(2)

			// Get the transformed tool_call id from assistant message
			const assistantMsg = result[0] as OpenAI.Chat.ChatCompletionAssistantMessageParam
			const transformedId = assistantMsg.tool_calls![0].id

			// The tool result should have the same transformed id
			const toolMsg = result[1] as OpenAI.Chat.ChatCompletionToolMessageParam
			toolMsg.tool_call_id.should.equal(transformedId)
		})

		it("should handle multiple tool calls in a single message", () => {
			const messages: ClineStorageMessage[] = [
				{
					role: "assistant",
					content: [
						{
							type: "text",
							text: "I'll read both files",
						} as ClineTextContentBlock,
						{
							type: "tool_use",
							id: "tool_1",
							name: "read_file",
							input: { path: "/file1.ts" },
						} as ClineAssistantToolUseBlock,
						{
							type: "tool_use",
							id: "tool_2",
							name: "read_file",
							input: { path: "/file2.ts" },
						} as ClineAssistantToolUseBlock,
					],
				},
			]

			const result = convertToOpenAiMessages(messages)

			result.should.have.length(1)
			const msg = result[0] as any
			msg.tool_calls.should.have.length(2)
			msg.tool_calls[0].function.name.should.equal("read_file")
			msg.tool_calls[1].function.name.should.equal("read_file")
		})

		it("should handle tool results with array content", () => {
			const messages: ClineStorageMessage[] = [
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool_123",
							content: [
								{ type: "text", text: "Line 1" },
								{ type: "text", text: "Line 2" },
							],
						} as ClineUserToolResultContentBlock,
					],
				},
			]

			const result = convertToOpenAiMessages(messages)

			result.should.have.length(1)
			const msg = result[0] as OpenAI.Chat.ChatCompletionToolMessageParam
			msg.role.should.equal("tool")
			msg.content.should.equal("Line 1\nLine 2")
		})

		it("should set content to null when only tool_calls present", () => {
			const messages: ClineStorageMessage[] = [
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "tool_1",
							name: "test",
							input: {},
						} as ClineAssistantToolUseBlock,
					],
				},
			]

			const result = convertToOpenAiMessages(messages)

			const msg = result[0] as any
			// Content should be null, not undefined or empty string
			;(msg.content === null).should.be.true()
		})
	})

	describe("convertToAnthropicMessage - OpenAI Response to Anthropic", () => {
		it("should convert OpenAI completion to Anthropic message format", () => {
			const completion: OpenAI.Chat.Completions.ChatCompletion = {
				id: "chatcmpl-123",
				object: "chat.completion",
				created: Date.now(),
				model: "gpt-4o",
				choices: [
					{
						index: 0,
						message: {
							role: "assistant",
							content: "Hello!",
							refusal: null,
						},
						finish_reason: "stop",
						logprobs: null,
					},
				],
				usage: {
					prompt_tokens: 10,
					completion_tokens: 5,
					total_tokens: 15,
				},
			}

			const result = convertToAnthropicMessage(completion)

			result.id.should.equal("chatcmpl-123")
			result.role.should.equal("assistant")
			result.model.should.equal("gpt-4o")
			result.stop_reason!.should.equal("end_turn")
			result.usage.input_tokens.should.equal(10)
			result.usage.output_tokens.should.equal(5)

			const content = result.content as any[]
			content[0].type.should.equal("text")
			content[0].text.should.equal("Hello!")
		})

		it("should convert OpenAI tool_calls to Anthropic tool_use blocks", () => {
			const completion: OpenAI.Chat.Completions.ChatCompletion = {
				id: "chatcmpl-456",
				object: "chat.completion",
				created: Date.now(),
				model: "gpt-4o",
				choices: [
					{
						index: 0,
						message: {
							role: "assistant",
							content: null,
							tool_calls: [
								{
									id: "call_abc",
									type: "function",
									function: {
										name: "read_file",
										arguments: '{"path":"/test.ts"}',
									},
								},
							],
							refusal: null,
						},
						finish_reason: "tool_calls",
						logprobs: null,
					},
				],
			}

			const result = convertToAnthropicMessage(completion)

			result.stop_reason!.should.equal("tool_use")

			const content = result.content as any[]
			content.should.have.length(2) // text block + tool_use block

			const toolUse = content.find((b) => b.type === "tool_use")
			toolUse.should.not.be.undefined
			toolUse.id.should.equal("call_abc")
			toolUse.name.should.equal("read_file")
			toolUse.input.should.deepEqual({ path: "/test.ts" })
		})

		it("should handle malformed tool arguments gracefully", () => {
			const completion: OpenAI.Chat.Completions.ChatCompletion = {
				id: "chatcmpl-789",
				object: "chat.completion",
				created: Date.now(),
				model: "gpt-4o",
				choices: [
					{
						index: 0,
						message: {
							role: "assistant",
							content: null,
							tool_calls: [
								{
									id: "call_bad",
									type: "function",
									function: {
										name: "test_tool",
										arguments: "not valid json",
									},
								},
							],
							refusal: null,
						},
						finish_reason: "tool_calls",
						logprobs: null,
					},
				],
			}

			// Should not throw, should return empty input
			const result = convertToAnthropicMessage(completion)

			const content = result.content as any[]
			const toolUse = content.find((b) => b.type === "tool_use")
			toolUse.input.should.deepEqual({})
		})

		it("should map finish_reason correctly", () => {
			const testCases: Array<{ finish_reason: any; expected: string | null }> = [
				{ finish_reason: "stop", expected: "end_turn" },
				{ finish_reason: "length", expected: "max_tokens" },
				{ finish_reason: "tool_calls", expected: "tool_use" },
				{ finish_reason: "content_filter", expected: null },
			]

			for (const { finish_reason, expected } of testCases) {
				const completion: OpenAI.Chat.Completions.ChatCompletion = {
					id: "test",
					object: "chat.completion",
					created: Date.now(),
					model: "test",
					choices: [
						{
							index: 0,
							message: { role: "assistant", content: "test", refusal: null },
							finish_reason,
							logprobs: null,
						},
					],
				}

				const result = convertToAnthropicMessage(completion)
				// Using equality check since should.be.true() doesn't accept message arg
				;(result.stop_reason === expected).should.be.true()
			}
		})
	})
})
