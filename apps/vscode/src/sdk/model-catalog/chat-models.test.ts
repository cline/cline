import { describe, expect, it } from "vitest"
import { filterChatModelMap, resolveChatModelDefault } from "./chat-models"

describe("VS Code chat model filtering", () => {
	it("keeps legacy, text, and mixed text-output models", () => {
		const models = new Map([
			["legacy", {}],
			[
				"chat",
				{
					modalities: {
						input: ["text"] as const,
						output: ["text"] as const,
					},
				},
			],
			[
				"mixed",
				{
					modalities: {
						input: ["text", "image"] as const,
						output: ["text", "image"] as const,
					},
				},
			],
		])

		expect([...filterChatModelMap(models).keys()]).toEqual(["legacy", "chat", "mixed"])
	})

	it("removes dedicated transcription and media-generation models", () => {
		const models = new Map([
			[
				"whisper",
				{
					modalities: {
						input: ["audio"] as const,
						output: ["text"] as const,
					},
				},
			],
			[
				"tts",
				{
					modalities: {
						input: ["text"] as const,
						output: ["audio"] as const,
					},
				},
			],
		])

		expect(filterChatModelMap(models).size).toBe(0)
	})

	it("falls back when the catalog default is not chat-compatible", () => {
		const models = new Map([["chat", {}]])
		expect(resolveChatModelDefault("whisper", models)).toBe("chat")
		expect(resolveChatModelDefault("chat", models)).toBe("chat")
		expect(resolveChatModelDefault("whisper", new Map())).toBeUndefined()
	})
})
