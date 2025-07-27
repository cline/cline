import { describe, it, expect, vi } from "vitest"
import { t } from "i18next"
import { GeminiHandler } from "../gemini"
import type { ApiHandlerOptions } from "../../../shared/api"

describe("GeminiHandler backend support", () => {
	it("passes tools for URL context and grounding in config", async () => {
		const options = {
			apiProvider: "gemini",
			enableUrlContext: true,
			enableGrounding: true,
		} as ApiHandlerOptions
		const handler = new GeminiHandler(options)
		const stub = vi.fn().mockReturnValue((async function* () {})())
		// @ts-ignore access private client
		handler["client"].models.generateContentStream = stub
		await handler.createMessage("instr", [] as any).next()
		const config = stub.mock.calls[0][0].config
		expect(config.tools).toEqual([{ urlContext: {} }, { googleSearch: {} }])
	})

	it("completePrompt passes config overrides without tools when URL context and grounding disabled", async () => {
		const options = {
			apiProvider: "gemini",
			enableUrlContext: false,
			enableGrounding: false,
		} as ApiHandlerOptions
		const handler = new GeminiHandler(options)
		const stub = vi.fn().mockResolvedValue({ text: "ok" })
		// @ts-ignore access private client
		handler["client"].models.generateContent = stub
		const res = await handler.completePrompt("hi")
		expect(res).toBe("ok")
		const promptConfig = stub.mock.calls[0][0].config
		expect(promptConfig.tools).toBeUndefined()
	})

	describe("error scenarios", () => {
		it("should handle grounding metadata extraction failure gracefully", async () => {
			const options = {
				apiProvider: "gemini",
				enableGrounding: true,
			} as ApiHandlerOptions
			const handler = new GeminiHandler(options)

			const mockStream = async function* () {
				yield {
					candidates: [
						{
							groundingMetadata: {
								// Invalid structure - missing groundingChunks
							},
							content: { parts: [{ text: "test response" }] },
						},
					],
					usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
				}
			}

			const stub = vi.fn().mockReturnValue(mockStream())
			// @ts-ignore access private client
			handler["client"].models.generateContentStream = stub

			const messages = []
			for await (const chunk of handler.createMessage("test", [] as any)) {
				messages.push(chunk)
			}

			// Should still return the main content without sources
			expect(messages.some((m) => m.type === "text" && m.text === "test response")).toBe(true)
			expect(messages.some((m) => m.type === "text" && m.text?.includes("Sources:"))).toBe(false)
		})

		it("should handle malformed grounding metadata", async () => {
			const options = {
				apiProvider: "gemini",
				enableGrounding: true,
			} as ApiHandlerOptions
			const handler = new GeminiHandler(options)

			const mockStream = async function* () {
				yield {
					candidates: [
						{
							groundingMetadata: {
								groundingChunks: [
									{ web: null }, // Missing URI
									{ web: { uri: "https://example.com" } }, // Valid
									{}, // Missing web property entirely
								],
							},
							content: { parts: [{ text: "test response" }] },
						},
					],
					usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
				}
			}

			const stub = vi.fn().mockReturnValue(mockStream())
			// @ts-ignore access private client
			handler["client"].models.generateContentStream = stub

			const messages = []
			for await (const chunk of handler.createMessage("test", [] as any)) {
				messages.push(chunk)
			}

			// Should only include valid citations
			const sourceMessage = messages.find((m) => m.type === "text" && m.text?.includes("[2]"))
			expect(sourceMessage).toBeDefined()
			if (sourceMessage && "text" in sourceMessage) {
				expect(sourceMessage.text).toContain("https://example.com")
				expect(sourceMessage.text).not.toContain("[1]")
				expect(sourceMessage.text).not.toContain("[3]")
			}
		})

		it("should handle API errors when tools are enabled", async () => {
			const options = {
				apiProvider: "gemini",
				enableUrlContext: true,
				enableGrounding: true,
			} as ApiHandlerOptions
			const handler = new GeminiHandler(options)

			const mockError = new Error("API rate limit exceeded")
			const stub = vi.fn().mockRejectedValue(mockError)
			// @ts-ignore access private client
			handler["client"].models.generateContentStream = stub

			await expect(async () => {
				const generator = handler.createMessage("test", [] as any)
				await generator.next()
			}).rejects.toThrow(t("common:errors.gemini.generate_stream", { error: "API rate limit exceeded" }))
		})
	})
})
