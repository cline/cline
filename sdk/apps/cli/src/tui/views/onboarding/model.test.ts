import { describe, expect, it } from "vitest";
import { getOAuthProviderLabel, toModelEntry, toProviderEntry } from "./model";

describe("onboarding model helpers", () => {
	it("maps provider catalog entries into onboarding provider entries", () => {
		expect(
			toProviderEntry({
				id: "cline",
				name: "Cline",
				apiKey: "",
				oauthAccessTokenPresent: true,
				models: 12,
				defaultModelId: "openai/gpt-5.3-codex",
			}),
		).toEqual({
			id: "cline",
			name: "Cline",
			isOAuth: true,
			hasAuth: true,
			models: 12,
			defaultModelId: "openai/gpt-5.3-codex",
		});
	});

	it("treats API key providers as authenticated when an API key exists", () => {
		expect(
			toProviderEntry({
				id: "anthropic",
				name: "Anthropic",
				apiKey: "sk-test",
				models: null,
			}),
		).toMatchObject({
			id: "anthropic",
			isOAuth: false,
			hasAuth: true,
			models: null,
		});
	});

	it("maps model names and reasoning support strictly", () => {
		expect(
			toModelEntry({
				id: "anthropic/claude-sonnet-4.6",
				supportsReasoning: false,
			}),
		).toEqual({
			id: "anthropic/claude-sonnet-4.6",
			name: "anthropic/claude-sonnet-4.6",
			supportsReasoning: false,
		});

		expect(
			toModelEntry({
				id: "openai/gpt-5.3-codex",
				name: "GPT-5.3 Codex",
				supportsReasoning: true,
			}),
		).toEqual({
			id: "openai/gpt-5.3-codex",
			name: "GPT-5.3 Codex",
			supportsReasoning: true,
		});
	});

	it("formats OAuth provider labels for onboarding status views", () => {
		expect(getOAuthProviderLabel("cline")).toBe("Cline");
		expect(getOAuthProviderLabel("openai-codex")).toBe("ChatGPT");
		expect(getOAuthProviderLabel("oca")).toBe("oca");
	});
});
