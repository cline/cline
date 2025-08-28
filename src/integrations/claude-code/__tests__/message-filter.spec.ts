import type { Anthropic } from "@anthropic-ai/sdk"

import { filterMessagesForClaudeCode } from "../message-filter"

describe("filterMessagesForClaudeCode", () => {
	test("should pass through string messages unchanged", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: "Hello, this is a simple text message",
			},
		]

		const result = filterMessagesForClaudeCode(messages)

		expect(result).toEqual(messages)
	})

	test("should pass through text-only content blocks unchanged", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "This is a text block",
					},
				],
			},
		]

		const result = filterMessagesForClaudeCode(messages)

		expect(result).toEqual(messages)
	})

	test("should replace image blocks with text placeholders", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "Here's an image:",
					},
					{
						type: "image",
						source: {
							type: "base64",
							media_type: "image/png",
							data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
						},
					},
				],
			},
		]

		const result = filterMessagesForClaudeCode(messages)

		expect(result).toEqual([
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "Here's an image:",
					},
					{
						type: "text",
						text: "[Image (base64): image/png not supported by Claude Code]",
					},
				],
			},
		])
	})

	test("should handle image blocks with unknown source types", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [
					{
						type: "image",
						source: undefined as any,
					},
				],
			},
		]

		const result = filterMessagesForClaudeCode(messages)

		expect(result).toEqual([
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "[Image (unknown): unknown not supported by Claude Code]",
					},
				],
			},
		])
	})

	test("should handle mixed content with multiple images", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "Compare these images:",
					},
					{
						type: "image",
						source: {
							type: "base64",
							media_type: "image/jpeg",
							data: "base64data1",
						},
					},
					{
						type: "text",
						text: "and",
					},
					{
						type: "image",
						source: {
							type: "base64",
							media_type: "image/gif",
							data: "base64data2",
						},
					},
					{
						type: "text",
						text: "What do you think?",
					},
				],
			},
		]

		const result = filterMessagesForClaudeCode(messages)

		expect(result).toEqual([
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "Compare these images:",
					},
					{
						type: "text",
						text: "[Image (base64): image/jpeg not supported by Claude Code]",
					},
					{
						type: "text",
						text: "and",
					},
					{
						type: "text",
						text: "[Image (base64): image/gif not supported by Claude Code]",
					},
					{
						type: "text",
						text: "What do you think?",
					},
				],
			},
		])
	})

	test("should handle multiple messages with images", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: "First message with text only",
			},
			{
				role: "assistant",
				content: [
					{
						type: "text",
						text: "I can help with that.",
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "Here's an image:",
					},
					{
						type: "image",
						source: {
							type: "base64",
							media_type: "image/png",
							data: "imagedata",
						},
					},
				],
			},
		]

		const result = filterMessagesForClaudeCode(messages)

		expect(result).toEqual([
			{
				role: "user",
				content: "First message with text only",
			},
			{
				role: "assistant",
				content: [
					{
						type: "text",
						text: "I can help with that.",
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "Here's an image:",
					},
					{
						type: "text",
						text: "[Image (base64): image/png not supported by Claude Code]",
					},
				],
			},
		])
	})

	test("should preserve other content block types unchanged", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "Regular text",
					},
					// This would be some other content type that's not an image
					{
						type: "tool_use" as any,
						id: "tool_123",
						name: "test_tool",
						input: { test: "data" },
					},
				],
			},
		]

		const result = filterMessagesForClaudeCode(messages)

		expect(result).toEqual(messages)
	})
})
