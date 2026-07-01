import { describe, expect, it } from "vitest";
import { safeParseSettings, toProviderConfig } from "./provider-settings";

describe("provider settings", () => {
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

	it("maps OpenAI Compatible provider pricing settings into model pricing", () => {
		const config = toProviderConfig({
			provider: "openai-compatible",
			model: "custom-model",
			pricing: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.02 },
		});

		expect(config.knownModels?.["custom-model"]?.pricing).toEqual({
			input: 0.1,
			output: 0.5,
			cacheRead: 0.01,
			cacheWrite: 0.02,
		});
	});

	it("does not overwrite catalog model info with sparse settings for non-OpenAI-Compatible providers", () => {
		const config = toProviderConfig({
			provider: "anthropic",
			model: "claude-sonnet-4-6",
		});

		expect(config.knownModels?.["claude-sonnet-4-6"]).toMatchObject({
			id: "claude-sonnet-4-6",
			contextWindow: expect.any(Number),
			maxTokens: expect.any(Number),
		});
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
});
