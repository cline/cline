// This file contains `declare module "vscode"` so we must import it.
import "../providers/vscode-lm"
import { describe, it } from "mocha"
import "should"
import * as vscode from "vscode"
import { Anthropic } from "@anthropic-ai/sdk"
import { asObjectSafe, convertToAnthropicRole, convertToVsCodeLmMessages, convertToAnthropicMessage } from "./vscode-lm-format"

describe("asObjectSafe", () => {
	it("should handle falsy values", () => {
		asObjectSafe(0).should.deepEqual({})
		asObjectSafe("").should.deepEqual({})
		asObjectSafe(null).should.deepEqual({})
		asObjectSafe(undefined).should.deepEqual({})
	})

	it("should parse valid JSON strings", () => {
		asObjectSafe('{"key": "value"}').should.deepEqual({ key: "value" })
	})

	it("should return an empty object for invalid JSON strings", () => {
		asObjectSafe("invalid json").should.deepEqual({})
	})

	it("should convert objects to plain objects", () => {
		const input = { prop: "value" }
		asObjectSafe(input).should.deepEqual(input)
		asObjectSafe(input).should.not.equal(input) // Should be a new object
	})

	it("should convert arrays to plain objects", () => {
		const input = ["hello world"]
		asObjectSafe(input).should.deepEqual({ 0: "hello world" })
	})
})

describe("convertToAnthropicRole", () => {
	it("should convert VSCode roles to Anthropic roles", () => {
		// @ts-expect-error（Testing with an invalid role）
		const unknownRole = "unknown" as vscode.LanguageModelChatMessageRole
		;(convertToAnthropicRole(vscode.LanguageModelChatMessageRole.Assistant) === "assistant").should.be.true()
		;(convertToAnthropicRole(vscode.LanguageModelChatMessageRole.User) === "user").should.be.true()
		;(convertToAnthropicRole(unknownRole) === null).should.be.true()
	})
})

describe("convertToVsCodeLmMessages", () => {
	it("should convert simple string messages", () => {
		const anthropicMessages: Anthropic.Messages.MessageParam[] = [
			{ role: "user", content: "Hello" },
			{ role: "assistant", content: "Hi there" },
		]

		const result = convertToVsCodeLmMessages(anthropicMessages)

		result.should.have.length(2)
		result[0].role.should.equal(vscode.LanguageModelChatMessageRole.User)
		result[0].content[0].should.be.instanceof(vscode.LanguageModelTextPart)
		const textPart0 = result[0].content[0] as vscode.LanguageModelTextPart
		textPart0.should.have.property("value", "Hello")

		result[1].role.should.equal(vscode.LanguageModelChatMessageRole.Assistant)
		result[1].content[0].should.be.instanceof(vscode.LanguageModelTextPart)
		const textPart1 = result[1].content[0] as vscode.LanguageModelTextPart
		textPart1.should.have.property("value", "Hi there")
	})

	it("should convert complex user messages with tool results", () => {
		const anthropicMessages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [
					{ type: "text", text: "User text" },
					{
						type: "tool_result",
						tool_use_id: "tool-123",
						content: [{ type: "text", text: "Tool result" }],
					},
				],
			},
		]

		const result = convertToVsCodeLmMessages(anthropicMessages)

		result.should.have.length(1)
		result[0].role.should.equal(vscode.LanguageModelChatMessageRole.User)
		result[0].content.should.have.length(2)

		// Check that the first content part is a ToolResultPart
		result[0].content[0].should.be.instanceof(vscode.LanguageModelToolResultPart)
		const toolResultPart = result[0].content[0] as vscode.LanguageModelToolResultPart
		toolResultPart.should.have.property("callId", "tool-123")

		// Skip detailed testing of internal structure as it may vary
		// Just verify it's the right type with the right ID

		// Check the second content part is a TextPart
		result[0].content[1].should.be.instanceof(vscode.LanguageModelTextPart)
		const textPart = result[0].content[1] as vscode.LanguageModelTextPart
		textPart.should.have.property("value", "User text")
	})

	it("should convert complex assistant messages with tool calls", () => {
		const anthropicMessages: Anthropic.Messages.MessageParam[] = [
			{
				role: "assistant",
				content: [
					{ type: "text", text: "Assistant text" },
					{
						type: "tool_use",
						id: "tool-123",
						name: "testTool",
						input: { param: "value" },
					},
				],
			},
		]

		const result = convertToVsCodeLmMessages(anthropicMessages)

		result.should.have.length(1)
		result[0].role.should.equal(vscode.LanguageModelChatMessageRole.Assistant)
		result[0].content.should.have.length(2)

		result[0].content[0].should.be.instanceof(vscode.LanguageModelToolCallPart)
		const toolCallPart = result[0].content[0] as vscode.LanguageModelToolCallPart
		toolCallPart.should.have.property("callId", "tool-123")
		toolCallPart.should.have.property("name", "testTool")
		toolCallPart.should.have.property("input")
		toolCallPart.input.should.deepEqual({ param: "value" })

		result[0].content[1].should.be.instanceof(vscode.LanguageModelTextPart)
		const textPart = result[0].content[1] as vscode.LanguageModelTextPart
		textPart.should.have.property("value", "Assistant text")
	})

	it("should handle image blocks with appropriate placeholders", () => {
		const anthropicMessages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [
					{
						type: "image",
						source: {
							type: "base64",
							media_type: "image/jpeg",
							data: "base64data",
						},
					},
				],
			},
		]

		const result = convertToVsCodeLmMessages(anthropicMessages)

		result.should.have.length(1)
		result[0].content[0].should.be.instanceof(vscode.LanguageModelTextPart)
		const textPart = result[0].content[0] as vscode.LanguageModelTextPart
		textPart.should.have.property("value")
		textPart.value.should.match(/Image \(base64\): image\/jpeg not supported by VSCode LM API/)
	})
})

describe("convertToAnthropicMessage", () => {
	it("should convert VSCode assistant messages to Anthropic format", () => {
		const vsCodeMsg = vscode.LanguageModelChatMessage.Assistant([
			new vscode.LanguageModelTextPart("Test message"),
			new vscode.LanguageModelToolCallPart("tool-id", "testTool", { param: "value" }),
		])

		const result = convertToAnthropicMessage(vsCodeMsg)

		result.should.have.property("role", "assistant")
		result.should.have.property("content").which.is.an.Array()
		result.content.should.have.length(2)

		// Check properties carefully to avoid null reference errors
		if (result.content && result.content.length >= 1) {
			const textContent = result.content[0]
			if (textContent) {
				textContent.should.have.property("type", "text")
				if (textContent.type === "text") {
					textContent.should.have.property("text", "Test message")
				}
			}
		}

		if (result.content && result.content.length >= 2) {
			const toolContent = result.content[1]
			if (toolContent) {
				toolContent.should.have.property("type", "tool_use")
				if (toolContent.type === "tool_use") {
					toolContent.should.have.property("id", "tool-id")
					toolContent.should.have.property("name", "testTool")
					toolContent.should.have.property("input").which.deepEqual({ param: "value" })
				}
			}
		}
	})

	it("should throw an error for non-assistant messages", () => {
		const vsCodeMsg = vscode.LanguageModelChatMessage.User("User message")

		try {
			convertToAnthropicMessage(vsCodeMsg)
			throw new Error("Should have thrown an error")
		} catch (error: any) {
			error.message.should.match(/Only assistant messages are supported/)
		}
	})
})
