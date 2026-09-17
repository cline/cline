import type { Anthropic } from "@anthropic-ai/sdk"
import { describe, it } from "mocha"
import "should"
import { convertToR1Format } from "../r1-format"

describe("convertToR1Format", () => {
	const image = {
		type: "image" as const,
		source: { type: "base64" as const, media_type: "image/png" as const, data: "aW1hZ2U=" },
	}

	it("preserves string tool-result content", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [{ type: "tool_result", tool_use_id: "tool_1", content: "result" }],
			},
		]

		convertToR1Format(messages).should.deepEqual([{ role: "user", content: "result" }])
	})

	it("joins array tool-result text content", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool_1",
						content: [
							{ type: "text", text: "first" },
							{ type: "text", text: "second" },
						],
					},
				],
			},
		]

		convertToR1Format(messages).should.deepEqual([{ role: "user", content: "first\nsecond" }])
	})

	it("keeps text and omits images from mixed tool-result content", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool_1",
						content: [{ type: "text", text: "result" }, image],
					},
				],
			},
		]

		convertToR1Format(messages).should.deepEqual([{ role: "user", content: "result" }])
	})

	it("preserves content when no tool result is present", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{ role: "user", content: [{ type: "text", text: "look" }, image] },
		]

		convertToR1Format(messages).should.deepEqual([
			{
				role: "user",
				content: [
					{ type: "text", text: "look" },
					{ type: "image_url", image_url: { url: "data:image/png;base64,aW1hZ2U=" } },
				],
			},
		])
	})
})