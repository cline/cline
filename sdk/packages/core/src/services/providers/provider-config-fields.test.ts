import * as LlmsModels from "@cline/llms";
import { afterEach, describe, expect, it } from "vitest";
import { registerCustomProvider } from "./local-provider-registry";
import { getProviderConfigFields } from "./provider-config-fields";

afterEach(() => {
	LlmsModels.resetRegistry();
});

describe("getProviderConfigFields", () => {
	it("returns api-key auth with only apiKey for cloud providers", () => {
		const result = getProviderConfigFields("anthropic");
		expect(result.providerId).toBe("anthropic");
		expect(result.authMethod).toBe("api-key");
		expect(result.fields.apiKey).toEqual({});
		expect(result.fields.baseUrl).toBeUndefined();
	});

	it("returns api-key auth with apiKey + baseUrl for ollama", () => {
		const result = getProviderConfigFields("ollama");
		expect(result.authMethod).toBe("api-key");
		expect(result.fields.apiKey).toEqual({
			note: "Keep empty if no API key for local inference.",
		});
		expect(result.fields.baseUrl?.defaultValue).toBe(
			"http://localhost:11434/v1",
		);
	});

	it("returns api-key auth with apiKey + baseUrl for LM Studio", () => {
		const result = getProviderConfigFields("lmstudio");
		expect(result.authMethod).toBe("api-key");
		expect(result.fields.apiKey).toEqual({});
		expect(result.fields.baseUrl?.defaultValue).toBe(
			"http://localhost:1234/v1",
		);
	});

	it("returns api-key auth with apiKey + baseUrl for LiteLLM", () => {
		const result = getProviderConfigFields("litellm");
		expect(result.authMethod).toBe("api-key");
		expect(result.fields.apiKey).toEqual({});
		expect(result.fields.baseUrl?.defaultValue).toBe(
			"http://localhost:4000/v1",
		);
	});

	it("returns api-key auth with apiKey + baseUrl for user-added providers", () => {
		registerCustomProvider("internal-router", {
			provider: {
				name: "Internal Router",
				baseUrl: "https://llm.internal.example/v1",
				defaultModelId: "alpha",
				protocol: "openai-responses",
			},
			models: {
				alpha: { name: "Alpha" },
			},
		});

		const result = getProviderConfigFields("internal-router");
		expect(result.authMethod).toBe("api-key");
		expect(result.fields.apiKey).toEqual({});
		expect(result.fields.baseUrl?.defaultValue).toBe(
			"https://llm.internal.example/v1",
		);
	});

	it("returns oauth auth with no fields for cline", () => {
		const result = getProviderConfigFields("cline");
		expect(result.authMethod).toBe("oauth");
		expect(result.fields).toEqual({});
	});

	it("returns oauth auth with no fields for openai-codex", () => {
		const result = getProviderConfigFields("openai-codex");
		expect(result.authMethod).toBe("oauth");
		expect(result.fields).toEqual({});
	});

	it("returns local auth with no fields for openai-codex-cli", () => {
		const result = getProviderConfigFields("openai-codex-cli");
		expect(result.authMethod).toBe("local");
		expect(result.fields).toEqual({});
	});

	it("returns api-key auth with apiKey + baseUrl for OpenAI Compatible", () => {
		const result = getProviderConfigFields("openai-compatible");
		expect(result.providerId).toBe("openai-compatible");
		expect(result.authMethod).toBe("api-key");
		expect(result.fields.apiKey).toEqual({});
		expect(result.fields.baseUrl?.defaultValue).toBe(
			"https://api.openai.com/v1",
		);
	});

	it("returns api-key auth with awsRegion, apiKey, and awsProfile for bedrock", () => {
		const result = getProviderConfigFields("bedrock");
		expect(result.providerId).toBe("bedrock");
		expect(result.authMethod).toBe("api-key");
		expect(result.description).toMatch(/AWS region/i);
		expect(Object.keys(result.fields)).toEqual([
			"awsRegion",
			"apiKey",
			"awsProfile",
		]);
		expect(result.fields.awsRegion?.label).toBe("AWS Region");
		expect(result.fields.awsRegion?.placeholder).toBe("us-east-1");
		expect(result.fields.apiKey?.optional).toBe(true);
		expect(result.fields.awsProfile?.optional).toBe(true);
	});

	it("falls back to a single api-key field for unknown providers", () => {
		const result = getProviderConfigFields("not-a-real-provider");
		expect(result.authMethod).toBe("api-key");
		expect(result.fields).toEqual({ apiKey: {} });
	});
});
