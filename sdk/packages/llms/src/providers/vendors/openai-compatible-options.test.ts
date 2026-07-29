import { describe, expect, it } from "vitest"
import { resolveOpenAICompatibleMaxOutputTokens } from "./openai-compatible-options"

describe("resolveOpenAICompatibleMaxOutputTokens", () => {
	it("omits gateway-synthesized Groq limits", () => {
		expect(resolveOpenAICompatibleMaxOutputTokens("groq", 32_000, true)).toBeUndefined()
	})

	it("preserves explicit Groq limits", () => {
		expect(resolveOpenAICompatibleMaxOutputTokens("groq", 4_096, false)).toBe(4_096)
	})

	it("preserves synthesized limits for other compatible providers", () => {
		expect(resolveOpenAICompatibleMaxOutputTokens("openrouter", 32_000, true)).toBe(32_000)
	})
})
