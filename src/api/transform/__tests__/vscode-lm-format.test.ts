import { Anthropic } from "@anthropic-ai/sdk"
import * as vscode from "vscode"
import { convertToVsCodeLmMessages, convertToAnthropicRole, convertToAnthropicMessage } from "../vscode-lm-format"

// Mock crypto
const mockCrypto = {
	randomUUID: () => "test-uuid",
}
global.crypto = mockCrypto as any

// Define types for our mocked classes
interface MockLanguageModelTextPart {
	type: "text"
	value: string
}

interface MockLanguageModelToolCallPart {
	type: "tool_call"
	callId: string
	name: string
	input: any
}

interface MockLanguageModelToolResultPart {
	type: "tool_result"
	toolUseId: string
	parts: MockLanguageModelTextPart[]
}

type MockMessageContent = MockLanguageModelTextPart | MockLanguageModelToolCallPart | MockLanguageModelToolResultPart

interface MockLanguageModelChatMessage {
	role: string
	name?: string
	content: MockMessageContent[]
}

// Mock vscode namespace
jest.mock("vscode", () => {
	const LanguageModelChatMessageRole = {
		Assistant: "assistant",
		User: "user",
	}

	class MockLanguageModelTextPart {
		type = "text"
		constructor(public value: string) {}
	}

	class MockLanguageModelToolCallPart {
		type = "tool_call"
		constructor(
			public callId: string,
			public name: string,
			public input: any,
		) {}
	}

	class MockLanguageModelToolResultPart {
		type = "tool_result"
		constructor(
			public toolUseId: string,
			public parts: MockLanguageModelTextPart[],
		) {}
	}

	return {
		LanguageModelChatMessage: {
			Assistant: jest.fn((content) => ({
				role: LanguageModelChatMessageRole.Assistant,
				name: "assistant",
				content: Array.isArray(content) ? content : [new MockLanguageModelTextPart(content)],
			})),
			User: jest.fn((content) => ({
				role: LanguageModelChatMessageRole.User,
				name: "user",
				content: Array.isArray(content) ? content : [new MockLanguageModelTextPart(content)],
			})),
		},
		LanguageModelChatMessageRole,
		LanguageModelTextPart: MockLanguageModelTextPart,
		LanguageModelToolCallPart: MockLanguageModelToolCallPart,
		LanguageModelToolResultPart: MockLanguageModelToolResultPart,
	}
})

describe("vscode-lm-format", () => {
	describe("convertToVsCodeLmMessages", () => {
		it("should convert simple string messages", () => {
			const messages: Anthropic.Messages.MessageParam[] = [
				{ role: "user", content: "Hello" },
				{ role: "assistant", content: "Hi there" },
			]

			const result = convertToVsCodeLmMessages(messages)

			expect(result).toHaveLength(2)
			expect(result[0].role).toBe("user")
			expect((result[0].content[0] as MockLanguageModelTextPart).value).toBe("Hello")
			expect(result[1].role).toBe("assistant")
			expect((result[1].content[0] as MockLanguageModelTextPart).value).toBe("Hi there")
		})

		it("should handle complex user messages with tool results", () => {
			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "user",
					content: [
						{ type: "text", text: "Here is the result:" },
						{
							type: "tool_result",
							tool_use_id: "tool-1",
							content: "Tool output",
						},
					],
				},
			]

			const result = convertToVsCodeLmMessages(messages)

			expect(result).toHaveLength(1)
			expect(result[0].role).toBe("user")
			expect(result[0].content).toHaveLength(2)
			const [toolResult, textContent] = result[0].content as [
				MockLanguageModelToolResultPart,
				MockLanguageModelTextPart,
			]
			expect(toolResult.type).toBe("tool_result")
			expect(textContent.type).toBe("text")
		})

		it("should handle complex assistant messages with tool calls", () => {
			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "assistant",
					content: [
						{ type: "text", text: "Let me help you with that." },
						{
							type: "tool_use",
							id: "tool-1",
							name: "calculator",
							input: { operation: "add", numbers: [2, 2] },
						},
					],
				},
			]

			const result = convertToVsCodeLmMessages(messages)

			expect(result).toHaveLength(1)
			expect(result[0].role).toBe("assistant")
			expect(result[0].content).toHaveLength(2)
			const [toolCall, textContent] = result[0].content as [
				MockLanguageModelToolCallPart,
				MockLanguageModelTextPart,
			]
			expect(toolCall.type).toBe("tool_call")
			expect(textContent.type).toBe("text")
		})

		it("should handle image blocks with appropriate placeholders", () => {
			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "user",
					content: [
						{ type: "text", text: "Look at this:" },
						{
							type: "image",
							source: {
								type: "base64",
								media_type: "image/png",
								data: "base64data",
							},
						},
					],
				},
			]

			const result = convertToVsCodeLmMessages(messages)

			expect(result).toHaveLength(1)
			const imagePlaceholder = result[0].content[1] as MockLanguageModelTextPart
			expect(imagePlaceholder.value).toContain("[Image (base64): image/png not supported by VSCode LM API]")
		})
	})

	describe("convertToAnthropicRole", () => {
		it("should convert assistant role correctly", () => {
			const result = convertToAnthropicRole("assistant" as any)
			expect(result).toBe("assistant")
		})

		it("should convert user role correctly", () => {
			const result = convertToAnthropicRole("user" as any)
			expect(result).toBe("user")
		})

		it("should return null for unknown roles", () => {
			const result = convertToAnthropicRole("unknown" as any)
			expect(result).toBeNull()
		})
	})

	describe("convertToAnthropicMessage", () => {
		it("should convert assistant message with text content", async () => {
			const vsCodeMessage = {
				role: "assistant",
				name: "assistant",
				content: [new vscode.LanguageModelTextPart("Hello")],
			}

			const result = await convertToAnthropicMessage(vsCodeMessage as any)

			expect(result.role).toBe("assistant")
			expect(result.content).toHaveLength(1)
			expect(result.content[0]).toEqual({
				type: "text",
				text: "Hello",
			})
			expect(result.id).toBe("test-uuid")
		})

		it("should convert assistant message with tool calls", async () => {
			const vsCodeMessage = {
				role: "assistant",
				name: "assistant",
				content: [
					new vscode.LanguageModelToolCallPart("call-1", "calculator", { operation: "add", numbers: [2, 2] }),
				],
			}

			const result = await convertToAnthropicMessage(vsCodeMessage as any)

			expect(result.content).toHaveLength(1)
			expect(result.content[0]).toEqual({
				type: "tool_use",
				id: "call-1",
				name: "calculator",
				input: { operation: "add", numbers: [2, 2] },
			})
			expect(result.id).toBe("test-uuid")
		})

		it("should throw error for non-assistant messages", async () => {
			const vsCodeMessage = {
				role: "user",
				name: "user",
				content: [new vscode.LanguageModelTextPart("Hello")],
			}

			await expect(convertToAnthropicMessage(vsCodeMessage as any)).rejects.toThrow(
				"Roo Code <Language Model API>: Only assistant messages are supported.",
			)
		})
	})
})
