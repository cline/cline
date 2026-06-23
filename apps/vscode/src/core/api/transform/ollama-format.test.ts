import { describe, it } from "mocha"
import "should"
import type { ClineStorageMessage } from "@/shared/messages/content"
import { convertToOllamaMessages } from "./ollama-format"

describe("convertToOllamaMessages", () => {
	it("sends user images as raw base64 image payloads", () => {
		const messages: Omit<ClineStorageMessage, "modelInfo">[] = [
			{
				role: "user",
				content: [
					{ type: "text", text: "Describe this image" },
					{
						type: "image",
						source: {
							type: "base64",
							media_type: "image/png",
							data: "aGVsbG8=",
						},
					},
				],
			},
		]

		const result = convertToOllamaMessages(messages)

		result.should.deepEqual([
			{
				role: "user",
				content: "Describe this image",
				images: ["aGVsbG8="],
			},
		])
	})

	it("sends tool result images as raw base64 image payloads", () => {
		const messages: Omit<ClineStorageMessage, "modelInfo">[] = [
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool-1",
						content: [
							{ type: "text", text: "Screenshot captured" },
							{
								type: "image",
								source: {
									type: "base64",
									media_type: "image/jpeg",
									data: "cmF3LWpwZw==",
								},
							},
						],
					},
				],
			},
		]

		const result = convertToOllamaMessages(messages)

		result.should.deepEqual([
			{
				role: "user",
				content: "Screenshot captured\n(see following user message for image)",
				images: ["cmF3LWpwZw=="],
			},
		])
	})
})
