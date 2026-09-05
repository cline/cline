import { describe, expect, it } from "vitest";
import { safeParseSettings, toProviderConfig } from "./provider-settings";

describe("provider settings", () => {
	it.each([
		undefined,
		"priority",
	] as const)("accepts serviceTier %s", (serviceTier) => {
		const result = safeParseSettings({ provider: "openai-codex", serviceTier });
		expect(result.success).toBe(true);
		if (!result.success) throw result.error;
		expect(result.data.serviceTier).toBe(serviceTier);
		expect(toProviderConfig(result.data).serviceTier).toBe(serviceTier);
	});

	it.each([
		"auto",
		"default",
		"flex",
		"",
		null,
		true,
		1,
	])("rejects invalid serviceTier %s", (serviceTier) => {
		expect(
			safeParseSettings({ provider: "openai-codex", serviceTier }).success,
		).toBe(false);
	});

	it.each([
		undefined,
		{ enabled: false, effort: "none" },
		{ enabled: true, effort: "high", budgetTokens: 2048 },
	] as const)("keeps service tier independent of reasoning %j", (reasoning) => {
		const result = safeParseSettings({
			provider: "openai-codex",
			serviceTier: "priority",
			reasoning,
		});
		if (!result.success) throw result.error;
		const config = toProviderConfig(result.data);
		const withoutTier = toProviderConfig({
			...result.data,
			serviceTier: undefined,
		});
		expect(config).toEqual({ ...withoutTier, serviceTier: "priority" });
		expect(result.data.reasoning).toEqual(reasoning);
	});

	it("formats Cline OAuth access tokens for runtime API keys", () => {
		const config = toProviderConfig({
			provider: "cline",
			model: "anthropic/claude-sonnet-4.6",
			auth: {
				accessToken: "oauth-access-token",
			},
		});

		expect(config.apiKey).toBe("workos:oauth-access-token");
		expect(config.accessToken).toBe("oauth-access-token");
	});

	it("accepts the Bedrock apikey authentication alias", () => {
		const result = safeParseSettings({
			provider: "bedrock",
			model: "anthropic.claude-sonnet-4-5-20250929-v1:0",
			aws: {
				authentication: "apikey",
				region: "us-east-1",
			},
		});

		expect(result.success).toBe(true);
		if (!result.success) {
			throw new Error("expected Bedrock apikey settings to parse");
		}

		expect(toProviderConfig(result.data).aws).toEqual(
			expect.objectContaining({
				authentication: "apikey",
			}),
		);
	});

	it("resolves the regional endpoint from apiLine when no base URL is set", () => {
		expect(
			toProviderConfig({ provider: "zai", apiLine: "china" }),
		).toMatchObject({
			apiLine: "china",
			baseUrl: "https://open.bigmodel.cn/api/paas/v4",
		});

		expect(
			toProviderConfig({ provider: "moonshot", apiLine: "china" }),
		).toMatchObject({
			baseUrl: "https://api.moonshot.cn/v1",
		});

		expect(
			toProviderConfig({ provider: "qwen", apiLine: "international" }),
		).toMatchObject({
			baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
		});
	});

	it("lets an explicit base URL win over apiLine", () => {
		expect(
			toProviderConfig({
				provider: "zai",
				apiLine: "china",
				baseUrl: "https://proxy.example.com/v4",
			}),
		).toMatchObject({
			baseUrl: "https://proxy.example.com/v4",
		});
	});

	it("keeps the provider default base URL when no apiLine is set", () => {
		expect(toProviderConfig({ provider: "zai" })).toMatchObject({
			baseUrl: "https://api.z.ai/api/paas/v4",
		});
		expect(toProviderConfig({ provider: "moonshot" })).toMatchObject({
			baseUrl: "https://api.moonshot.ai/v1",
		});
	});
});
