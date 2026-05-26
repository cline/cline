import type { ProviderSettings } from "@cline/core";
import { describe, expect, it } from "vitest";
import { isProviderSettingsUsable } from "./provider-readiness";

describe("provider readiness", () => {
	it("rejects missing and mismatched provider settings", () => {
		expect(isProviderSettingsUsable("anthropic", undefined)).toBe(false);
		expect(
			isProviderSettingsUsable("anthropic", {
				provider: "openai-native",
				apiKey: "sk-test",
			} satisfies ProviderSettings),
		).toBe(false);
	});

	it("requires usable OAuth credentials for OAuth providers", () => {
		expect(
			isProviderSettingsUsable("cline", {
				provider: "cline",
				model: "claude-sonnet-4-6",
			} satisfies ProviderSettings),
		).toBe(false);
		expect(
			isProviderSettingsUsable("cline", {
				provider: "cline",
				auth: { accessToken: "token" },
			} satisfies ProviderSettings),
		).toBe(true);
	});

	it("accepts manual API keys for API-key providers", () => {
		expect(
			isProviderSettingsUsable("anthropic", {
				provider: "anthropic",
				model: "claude-sonnet-4-6",
			} satisfies ProviderSettings),
		).toBe(false);
		expect(
			isProviderSettingsUsable("anthropic", {
				provider: "anthropic",
				apiKey: "sk-ant-test",
			} satisfies ProviderSettings),
		).toBe(true);
	});

	it("accepts saved local auth providers without an API key", () => {
		expect(
			isProviderSettingsUsable("openai-codex-cli", {
				provider: "openai-codex-cli",
			} satisfies ProviderSettings),
		).toBe(true);
	});

	it("accepts keyless local providers with a resolved endpoint and model", () => {
		expect(
			isProviderSettingsUsable(
				"ollama",
				{
					provider: "ollama",
					model: "llama3.2",
				} satisfies ProviderSettings,
				{
					baseUrl: "http://localhost:11434/v1",
					modelId: "llama3.2",
				},
			),
		).toBe(true);
	});

	it("rejects keyless local providers without a selected model", () => {
		expect(
			isProviderSettingsUsable(
				"ollama",
				{
					provider: "ollama",
				} satisfies ProviderSettings,
				{
					baseUrl: "http://localhost:11434/v1",
					modelId: "",
				},
			),
		).toBe(false);
	});

	it("accepts provider-specific cloud credentials", () => {
		expect(
			isProviderSettingsUsable("bedrock", {
				provider: "bedrock",
				aws: { profile: "default" },
			} satisfies ProviderSettings),
		).toBe(false);
		expect(
			isProviderSettingsUsable("bedrock", {
				provider: "bedrock",
				apiKey: "bedrock-api-key",
			} satisfies ProviderSettings),
		).toBe(false);
		expect(
			isProviderSettingsUsable("bedrock", {
				provider: "bedrock",
				apiKey: "bedrock-api-key",
				aws: { region: "us-east-1", authentication: "api-key" },
			} satisfies ProviderSettings),
		).toBe(true);
		expect(
			isProviderSettingsUsable("bedrock", {
				provider: "bedrock",
				aws: { profile: "default", region: "us-west-2" },
			} satisfies ProviderSettings),
		).toBe(true);
		expect(
			isProviderSettingsUsable("bedrock", {
				provider: "bedrock",
				aws: { authentication: "iam", region: "us-east-1" },
			} satisfies ProviderSettings),
		).toBe(true);
		expect(
			isProviderSettingsUsable("bedrock", {
				provider: "bedrock",
				region: "us-east-1",
				aws: { authentication: "iam" },
			} satisfies ProviderSettings),
		).toBe(true);
		expect(
			isProviderSettingsUsable("bedrock", {
				provider: "bedrock",
				aws: { authentication: "profile", region: "us-east-1" },
			} satisfies ProviderSettings),
		).toBe(true);
		expect(
			isProviderSettingsUsable("bedrock", {
				provider: "bedrock",
				aws: { accessKey: "access", secretKey: "secret", region: "us-east-1" },
			} satisfies ProviderSettings),
		).toBe(true);
		expect(
			isProviderSettingsUsable("vertex", {
				provider: "vertex",
				gcp: { projectId: "test-project" },
			} satisfies ProviderSettings),
		).toBe(true);
		expect(
			isProviderSettingsUsable("sapaicore", {
				provider: "sapaicore",
				baseUrl: "https://api.ai.example.invalid",
				sap: {
					clientId: "client",
					clientSecret: "secret",
					tokenUrl: "https://example.com/token",
				},
			} satisfies ProviderSettings),
		).toBe(true);
	});
});
