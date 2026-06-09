import { describe, expect, it } from "vitest"
import { toLegacyApiProvider } from "./provider-helpers"

describe("toLegacyApiProvider", () => {
	it("up-cases the nousResearch id to its legacy ApiConfiguration spelling", () => {
		expect(toLegacyApiProvider("nousResearch")).toBe("nousResearch")
		expect(toLegacyApiProvider("nousresearch")).toBe("nousResearch")
	})

	it("passes through other ids unchanged", () => {
		expect(toLegacyApiProvider("deepseek")).toBe("deepseek")
		expect(toLegacyApiProvider("anthropic")).toBe("anthropic")
		expect(toLegacyApiProvider("openai-codex")).toBe("openai-codex")
	})
})
