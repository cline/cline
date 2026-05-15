import { describe, expect, it } from "vitest"
import { GENERIC_PROVIDER_SETTINGS, getGenericProviderSettings } from "./providerSettingsRegistry"

describe("providerSettingsRegistry", () => {
	it("registers DeepSeek as a generic catalog-backed provider without base URL", () => {
		expect(getGenericProviderSettings("deepseek")).toEqual({
			allowsCustomIds: false,
			apiKeyField: "deepSeekApiKey",
			providerId: "deepseek",
			providerName: "DeepSeek",
			signupUrl: "https://www.deepseek.com/",
		})
	})

	it("registers Gemini with its custom base URL field", () => {
		expect(getGenericProviderSettings("gemini")).toEqual({
			allowsCustomIds: false,
			apiKeyField: "geminiApiKey",
			baseUrlField: {
				field: "geminiBaseUrl",
				label: "Use custom base URL",
				placeholder: "Default: https://generativelanguage.googleapis.com",
			},
			providerId: "gemini",
			providerName: "Gemini",
			signupUrl: "https://aistudio.google.com/apikey",
		})
	})

	it("does not accidentally claim not-yet-migrated providers", () => {
		expect(getGenericProviderSettings("groq")).toBeUndefined()
		expect(getGenericProviderSettings("cerebras")).toBeUndefined()
		expect(getGenericProviderSettings("openai")).toBeUndefined()
		expect(Object.keys(GENERIC_PROVIDER_SETTINGS).sort()).toEqual(["deepseek", "gemini"])
	})
})
