import type { ProviderListing } from "@shared/proto/cline/models"
import { describe, expect, it } from "vitest"
import {
	getFallbackGenericProviderSettings,
	getGenericProviderSettings,
	hasCustomProviderSettings,
	isGenericProviderListing,
} from "./providerSettingsRegistry"

function listing(overrides: Partial<ProviderListing>): ProviderListing {
	return {
		allowsCustomModelIds: false,
		id: "deepseek",
		name: "DeepSeek",
		protocol: "openai-chat",
		...overrides,
	}
}

describe("providerSettingsRegistry", () => {
	it("builds DeepSeek generic settings from SDK provider-listing metadata", () => {
		expect(getGenericProviderSettings("deepseek", listing({ id: "deepseek", name: "DeepSeek" }))).toEqual({
			allowsCustomIds: false,
			providerId: "deepseek",
			providerName: "DeepSeek",
			signupUrl: "https://www.deepseek.com/",
		})
	})

	it("builds Gemini generic settings from provider-listing metadata plus presentation overrides", () => {
		expect(
			getGenericProviderSettings(
				"gemini",
				listing({ id: "gemini", name: "Google Gemini", protocol: "gemini", allowsCustomModelIds: false }),
			),
		).toEqual({
			allowsCustomIds: false,
			baseUrlField: {
				label: "Use custom base URL",
				placeholder: "Default: https://generativelanguage.googleapis.com",
			},
			providerId: "gemini",
			providerName: "Google Gemini",
			signupUrl: "https://aistudio.google.com/apikey",
		})
	})

	it("keeps provider-specific UIs as explicit custom overrides", () => {
		expect(hasCustomProviderSettings("openai")).toBe(true)
		expect(hasCustomProviderSettings("deepseek")).toBe(false)
		expect(hasCustomProviderSettings("groq")).toBe(false)
		expect(hasCustomProviderSettings("cerebras")).toBe(false)
		expect(getGenericProviderSettings("openai", listing({ id: "openai", name: "OpenAI" }))).toBeUndefined()
	})

	it("allows migrated simple SDK providers to use the generic fallback", () => {
		const migratedProviders = [
			["baseten", "Baseten", "https://app.baseten.co/settings/api_keys"],
			["cerebras", "Cerebras", "https://cloud.cerebras.ai/"],
			["fireworks", "Fireworks", "https://fireworks.ai/"],
			["groq", "Groq", "https://console.groq.com/keys"],
			["huggingface", "Hugging Face", "https://huggingface.co/settings/tokens"],
			["nebius", "Nebius", "https://studio.nebius.com/settings/api-keys"],
			["sambanova", "SambaNova", "https://docs.sambanova.ai/cloud/docs/get-started/overview"],
			["vercel-ai-gateway", "Vercel AI Gateway", "https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai"],
		] as const

		for (const [providerId, providerName, signupUrl] of migratedProviders) {
			expect(hasCustomProviderSettings(providerId)).toBe(false)
			expect(getGenericProviderSettings(providerId, listing({ id: providerId, name: providerName }))).toEqual({
				allowsCustomIds: false,
				providerId,
				providerName,
				...(signupUrl ? { signupUrl } : {}),
			})
		}
	})

	it("allows future simple SDK providers to use the generic fallback", () => {
		const futureProvider = listing({
			allowsCustomModelIds: true,
			id: "future-simple-provider",
			name: "Future Simple Provider",
			protocol: "openai-chat",
		})

		expect(isGenericProviderListing(futureProvider)).toBe(true)
		expect(getGenericProviderSettings("future-simple-provider", futureProvider)).toEqual({
			allowsCustomIds: true,
			providerId: "future-simple-provider",
			providerName: "Future Simple Provider",
		})
	})

	it("requires listing metadata that proves the provider has a supported simple protocol", () => {
		expect(
			getGenericProviderSettings("unknown", listing({ id: "unknown", name: "Unknown", protocol: undefined })),
		).toBeUndefined()
		expect(
			getGenericProviderSettings("unknown", listing({ id: "unknown", name: "Unknown", protocol: "custom" })),
		).toBeUndefined()
		expect(
			getGenericProviderSettings("other", listing({ id: "unknown", name: "Unknown", protocol: "openai-chat" })),
		).toBeUndefined()
	})

	it("keeps wrapper fallback metadata for import/render compatibility", () => {
		expect(getFallbackGenericProviderSettings("deepseek")).toEqual({
			allowsCustomIds: false,
			providerId: "deepseek",
			providerName: "DeepSeek",
			signupUrl: "https://www.deepseek.com/",
		})
	})
})
