import type { ProviderSettings } from "@clinebot/core";
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

	it("accepts provider-specific cloud credentials", () => {
		expect(
			isProviderSettingsUsable("bedrock", {
				provider: "bedrock",
				aws: { profile: "default" },
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
				sap: {
					clientId: "client",
					clientSecret: "secret",
					tokenUrl: "https://example.com/token",
				},
			} satisfies ProviderSettings),
		).toBe(true);
	});
});
