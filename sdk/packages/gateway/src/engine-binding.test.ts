import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EngineInvocation } from "@cline/bot";
import {
	createBotId,
	createRunId,
	createSessionId,
} from "@cline/shared/gateway";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createConfiguredEnginePort,
	MissingProviderCredentialError,
	ModelNotConfiguredError,
	resolveModelFromEnvironment,
	resolveProviderModel,
} from "./engine-binding";
import { resolveGatewayPaths } from "./paths";
import {
	listSavedProviderSummaries,
	resolveSavedClineOAuthApiKey,
} from "./provider-settings";
import { writeSecretFile } from "./secrets";
import { tempDataRoot } from "./test-support";

function invocation(
	config: EngineInvocation["effectiveConfig"] = {},
): EngineInvocation {
	return {
		runId: createRunId(),
		sessionId: createSessionId(),
		botId: createBotId(),
		input: "prompt",
		workspaceRoot: "/tmp/w",
		effectiveConfig: config,
	};
}

function makePaths() {
	return resolveGatewayPaths({
		dataRoot: tempDataRoot(),
		namespace: "default",
	});
}

function settingsFile(input: unknown): string {
	const file = join(
		mkdtempSync(join(tmpdir(), "gateway-provider-")),
		"providers.json",
	);
	writeFileSync(file, JSON.stringify(input));
	return file;
}

function storedSettings(
	lastUsedProvider: string,
	providers: Record<string, Record<string, unknown>>,
) {
	return {
		version: 1,
		lastUsedProvider,
		modes: {},
		providers: Object.fromEntries(
			Object.entries(providers).map(([providerId, settings]) => [
				providerId,
				{
					settings: { provider: providerId, ...settings },
					updatedAt: "2026-08-19T00:00:00.000Z",
					tokenSource: "manual",
				},
			]),
		),
	};
}

describe("resolveProviderModel", () => {
	afterEach(() => vi.restoreAllMocks());

	it("reads a mode-0600 gateway secret", () => {
		const paths = makePaths();
		writeSecretFile(paths, "anthropic", "sk-from-file");
		expect(
			resolveProviderModel(
				invocation({ providerId: "anthropic", modelId: "claude-x" }),
				{ env: {}, paths },
			),
		).toMatchObject({
			providerId: "anthropic",
			modelId: "claude-x",
			apiKey: "sk-from-file",
		});
	});

	it("gives environment credentials precedence over gateway secrets", () => {
		const paths = makePaths();
		writeSecretFile(paths, "anthropic", "sk-from-file");
		expect(
			resolveProviderModel(
				invocation({ providerId: "anthropic", modelId: "claude-x" }),
				{
					env: { CLINE_GATEWAY_API_KEY: "sk-env" },
					paths,
				},
			),
		).toMatchObject({ apiKey: "sk-env" });
	});

	it("uses provider selection, options, and credentials from providers.json", () => {
		const file = settingsFile(
			storedSettings("anthropic", {
				anthropic: {
					model: "claude-test",
					apiKey: "saved-key",
					baseUrl: "https://example.test",
					headers: { "x-test": "yes" },
					timeout: 12_345,
				},
			}),
		);
		expect(resolveModelFromEnvironment(invocation(), {}, file)).toEqual({
			kind: "provider",
			providerId: "anthropic",
			modelId: "claude-test",
			apiKey: "saved-key",
			baseUrl: "https://example.test",
			headers: { "x-test": "yes" },
			timeoutMs: 12_345,
			options: undefined,
		});
	});

	it("lists only UI-safe configured provider and model summaries", async () => {
		const file = settingsFile(
			storedSettings("anthropic", {
				"custom-alpha": { model: "claude-test", apiKey: "secret" },
				"custom-beta": { model: "vendor/model", apiKey: "other-secret" },
				litellm: { apiKey: "hidden-without-model" },
			}),
		);
		await expect(
			listSavedProviderSummaries({ filePath: file, env: {} }),
		).resolves.toEqual({
			selectedProviderId: "anthropic",
			providers: [
				{ providerId: "custom-alpha", modelIds: ["claude-test"] },
				{ providerId: "custom-beta", modelIds: ["vendor/model"] },
			],
		});
	});

	it("formats saved Cline OAuth credentials", () => {
		const file = settingsFile(
			storedSettings("cline", {
				cline: {
					model: "cline/model",
					auth: {
						accessToken: "token",
						refreshToken: "refresh",
						expiresAt: Date.now() + 60_000,
					},
				},
			}),
		);
		expect(resolveModelFromEnvironment(invocation(), {}, file)).toMatchObject({
			apiKey: "workos:token",
		});
	});

	it("refreshes expired Cline OAuth credentials and persists token rotation", async () => {
		const file = settingsFile(
			storedSettings("cline", {
				cline: {
					model: "cline/model",
					auth: {
						accessToken: "expired",
						refreshToken: "refresh-old",
						expiresAt: 1,
					},
				},
			}),
		);
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					success: true,
					data: {
						accessToken: "access-new",
						refreshToken: "refresh-new",
						tokenType: "Bearer",
						expiresAt: "2099-01-01T00:00:00.000Z",
						userInfo: { clineUserId: "usr-test", email: "test@example.com" },
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		);

		await expect(
			resolveSavedClineOAuthApiKey("cline", { filePath: file, env: {} }),
		).resolves.toBe("workos:access-new");
		const persisted = JSON.parse(readFileSync(file, "utf8"));
		expect(persisted.providers.cline.settings.auth).toMatchObject({
			accessToken: "access-new",
			refreshToken: "refresh-new",
			accountId: "usr-test",
		});
		expect(persisted.providers.cline.tokenSource).toBe("oauth");
	});

	it("uses the Cline credential bucket for Cline Pass", () => {
		const file = settingsFile(
			storedSettings("cline-pass", {
				cline: { auth: { accessToken: "shared-token" } },
				"cline-pass": { model: "cline-pass/model" },
			}),
		);
		expect(resolveModelFromEnvironment(invocation(), {}, file)).toMatchObject({
			providerId: "cline-pass",
			modelId: "cline-pass/model",
			apiKey: "workos:shared-token",
		});
	});

	it("fails closed when model selection or credentials are absent", async () => {
		const emptySettings = settingsFile(storedSettings("", {}));
		expect(() =>
			resolveProviderModel(invocation(), {
				env: {},
				providerSettingsPath: emptySettings,
			}),
		).toThrow(ModelNotConfiguredError);
		expect(() =>
			resolveProviderModel(
				invocation({ providerId: "anthropic", modelId: "claude-x" }),
				{ env: {}, providerSettingsPath: emptySettings },
			),
		).toThrow(MissingProviderCredentialError);
		const outcome = await createConfiguredEnginePort({
			env: {},
			paths: makePaths(),
			providerSettingsPath: emptySettings,
		}).start(invocation({ providerId: "anthropic", modelId: "claude-x" }))
			.result;
		expect(outcome.error?.name).toBe("MissingProviderCredentialError");
	});
});
