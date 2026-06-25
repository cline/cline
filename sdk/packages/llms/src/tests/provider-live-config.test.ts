import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toLiveProviderConfig } from "./provider-live-config";

describe("toLiveProviderConfig", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("resolves api keys, base URLs, and headers from environment variables", () => {
		vi.stubEnv("LIVE_PROVIDER_API_KEY", "oauth-token");
		vi.stubEnv("LIVE_PROVIDER_BASE_URL", "https://example.test/v1");
		vi.stubEnv("LIVE_PROVIDER_ACCOUNT_ID", "acct-123");

		expect(
			toLiveProviderConfig({
				provider: "openai-codex",
				model: "gpt-5.4",
				apiKeyEnv: "LIVE_PROVIDER_API_KEY",
				baseUrlEnv: "LIVE_PROVIDER_BASE_URL",
				headers: {
					originator: "cline-live-test",
				},
				headersEnv: {
					"ChatGPT-Account-Id": "LIVE_PROVIDER_ACCOUNT_ID",
				},
				reasoning: {
					effort: "high",
				},
			}),
		).toMatchObject({
			providerId: "openai-codex",
			modelId: "gpt-5.4",
			apiKey: "oauth-token",
			baseUrl: "https://example.test/v1",
			headers: {
				originator: "cline-live-test",
				"ChatGPT-Account-Id": "acct-123",
			},
			reasoningEffort: "high",
		});
	});

	it("throws a clear error when an env-backed secret is missing", () => {
		expect(() =>
			toLiveProviderConfig({
				provider: "openai-codex",
				apiKeyEnv: "MISSING_LIVE_PROVIDER_API_KEY",
			}),
		).toThrow(
			"apiKeyEnv references unset or empty environment variable MISSING_LIVE_PROVIDER_API_KEY",
		);
	});

	it("loads OpenAI Codex OAuth credentials from saved provider settings", () => {
		const dir = mkdtempSync(path.join(tmpdir(), "llms-live-provider-"));
		const providersPath = path.join(dir, "providers.json");
		vi.stubEnv("CLINE_PROVIDER_SETTINGS_PATH", providersPath);
		writeFileSync(
			providersPath,
			JSON.stringify({
				version: 1,
				providers: {
					"openai-codex": {
						settings: {
							provider: "openai-codex",
							auth: {
								accessToken: "saved-access-token",
								accountId: "saved-account-id",
							},
						},
					},
				},
			}),
			"utf8",
		);

		expect(
			toLiveProviderConfig({
				provider: "openai-codex",
				model: "gpt-5.4",
				headers: {
					originator: "cline-live-test",
				},
			}),
		).toMatchObject({
			providerId: "openai-codex",
			modelId: "gpt-5.4",
			apiKey: "saved-access-token",
			headers: {
				originator: "cline-live-test",
				"ChatGPT-Account-Id": "saved-account-id",
			},
		});
	});
});
