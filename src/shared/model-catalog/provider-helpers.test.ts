import { describe, expect, it } from "vitest"
import { isMigratedSdkProvider, toLegacyApiProvider } from "./provider-helpers"

describe("model catalog provider helpers", () => {
	it("centralizes SDK provider id to legacy ApiProvider casing", () => {
		expect(toLegacyApiProvider("nousresearch")).toBe("nousResearch")
		expect(toLegacyApiProvider("deepseek")).toBe("deepseek")
	})

	it("centralizes migrated SDK provider membership", () => {
		expect(isMigratedSdkProvider("cline")).toBe(true)
		expect(isMigratedSdkProvider("deepseek")).toBe(true)
		expect(isMigratedSdkProvider("gemini")).toBe(true)
		expect(isMigratedSdkProvider("anthropic")).toBe(false)
		expect(isMigratedSdkProvider(undefined)).toBe(false)
	})
})
