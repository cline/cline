import { describe, expect, it } from "vitest";
import { allowsMissingOpenAiCompatibleApiKey } from "./http";

describe("allowsMissingOpenAiCompatibleApiKey", () => {
	it("allows local lmstudio and ollama providers without an API key", () => {
		expect(
			allowsMissingOpenAiCompatibleApiKey("lmstudio", {
				providerId: "lmstudio",
			}),
		).toBe(true);
		expect(
			allowsMissingOpenAiCompatibleApiKey("ollama", {
				providerId: "ollama",
			}),
		).toBe(true);
	});

	it("allows any provider when an authorization header is present", () => {
		expect(
			allowsMissingOpenAiCompatibleApiKey("openai-compatible", {
				providerId: "openai-compatible",
				headers: { Authorization: "Bearer token" },
			}),
		).toBe(true);
	});

	it("still requires API keys for other openai-compatible providers", () => {
		expect(
			allowsMissingOpenAiCompatibleApiKey("openrouter", {
				providerId: "openrouter",
			}),
		).toBe(false);
	});
});
