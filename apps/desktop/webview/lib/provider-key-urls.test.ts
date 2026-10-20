import { describe, expect, it } from "vitest";
import { getProviderApiKeyUrl } from "./provider-key-urls";

describe("getProviderApiKeyUrl", () => {
	it("prefers the catalog docUrl when present", () => {
		expect(
			getProviderApiKeyUrl({
				id: "anthropic",
				docUrl: "https://example.com/keys",
			}),
		).toBe("https://example.com/keys");
	});

	it("falls back to curated URLs for popular providers", () => {
		expect(getProviderApiKeyUrl({ id: "anthropic" })).toBe(
			"https://console.anthropic.com/settings/keys",
		);
		expect(getProviderApiKeyUrl({ id: "openai-native" })).toBe(
			"https://platform.openai.com/api-keys",
		);
		expect(getProviderApiKeyUrl({ id: "OpenRouter" })).toBe(
			"https://openrouter.ai/settings/keys",
		);
	});

	it("returns null for unknown providers", () => {
		expect(getProviderApiKeyUrl({ id: "some-obscure-provider" })).toBeNull();
		expect(getProviderApiKeyUrl({ id: "", docUrl: "   " })).toBeNull();
	});
});
