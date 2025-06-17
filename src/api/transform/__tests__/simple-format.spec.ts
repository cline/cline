// npx vitest run src/api/transform/__tests__/simple-format.spec.ts

import { Anthropic } from "@anthropic-ai/sdk"
import { convertToSimpleContent, convertToSimpleMessages } from "../simple-format"

describe("simple-format", () => {
	describe("convertToSimpleContent", () => {
		it("returns string content as-is", () => {
			const content = "Hello world"
			expect(convertToSimpleContent(content)).toBe("Hello world")
		})

		it("extracts text from text blocks", () => {
			const content = [
				{ type: "text", text: "Hello" },
				{ type: "text", text: "world" },
			] as Anthropic.Messages.TextBlockParam[]
			expect(convertToSimpleContent(content)).toBe("Hello\nworld")
		})

		it("converts image blocks to descriptive text", () => {
			const content = [
				{ type: "text", text: "Here's an image:" },
				{
					type: "image",
					source: {
						type: "base64",
						media_type: "image/png",
						data: "base64data",
					},
				},
			] as Array<Anthropic.Messages.TextBlockParam | Anthropic.Messages.ImageBlockParam>
			expect(convertToSimpleContent(content)).toBe("Here's an image:\n[Image: image/png]")
		})

		it("converts tool use blocks to descriptive text", () => {
			const content = [
				{ type: "text", text: "Using a tool:" },
				{
					type: "tool_use",
					id: "tool-1",
					name: "read_file",
					input: { path: "test.txt" },
				},
			] as Array<Anthropic.Messages.TextBlockParam | Anthropic.Messages.ToolUseBlockParam>
			expect(convertToSimpleContent(content)).toBe("Using a tool:\n[Tool Use: read_file]")
		})

		it("handles string tool result content", () => {
			const content = [
				{ type: "text", text: "Tool result:" },
				{
					type: "tool_result",
					tool_use_id: "tool-1",
					content: "Result text",
				},
			] as Array<Anthropic.Messages.TextBlockParam | Anthropic.Messages.ToolResultBlockParam>
			expect(convertToSimpleContent(content)).toBe("Tool result:\nResult text")
		})

		it("handles array tool result content with text and images", () => {
			const content = [
				{
					type: "tool_result",
					tool_use_id: "tool-1",
					content: [
						{ type: "text", text: "Result 1" },
						{
							type: "image",
							source: {
								type: "base64",
								media_type: "image/jpeg",
								data: "base64data",
							},
						},
						{ type: "text", text: "Result 2" },
					],
				},
			] as Anthropic.Messages.ToolResultBlockParam[]
			expect(convertToSimpleContent(content)).toBe("Result 1\n[Image: image/jpeg]\nResult 2")
		})

		it("filters out empty strings", () => {
			const content = [
				{ type: "text", text: "Hello" },
				{ type: "text", text: "" },
				{ type: "text", text: "world" },
			] as Anthropic.Messages.TextBlockParam[]
			expect(convertToSimpleContent(content)).toBe("Hello\nworld")
		})
	})

	describe("convertToSimpleMessages", () => {
		it("converts messages with string content", () => {
			const messages = [
				{ role: "user", content: "Hello" },
				{ role: "assistant", content: "Hi there" },
			] as Anthropic.Messages.MessageParam[]
			expect(convertToSimpleMessages(messages)).toEqual([
				{ role: "user", content: "Hello" },
				{ role: "assistant", content: "Hi there" },
			])
		})

		it("converts messages with complex content", () => {
			const messages = [
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
				{
					role: "assistant",
					content: [
						{ type: "text", text: "I see the image" },
						{
							type: "tool_use",
							id: "tool-1",
							name: "analyze_image",
							input: { data: "base64data" },
						},
					],
				},
			] as Anthropic.Messages.MessageParam[]
			expect(convertToSimpleMessages(messages)).toEqual([
				{ role: "user", content: "Look at this:\n[Image: image/png]" },
				{ role: "assistant", content: "I see the image\n[Tool Use: analyze_image]" },
			])
		})
	})
})
