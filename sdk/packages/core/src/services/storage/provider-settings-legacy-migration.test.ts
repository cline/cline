import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	type LegacyClineUserInfo,
	migrateLegacyProviderSettings,
	resolveLegacyClineAuth,
} from "./provider-settings-legacy-migration";
import { ProviderSettingsManager } from "./provider-settings-manager";

describe("migrateLegacyProviderSettings", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("migrates legacy provider state into providers.json when target is empty", () => {
		const tempDir = mkdtempSync(
			path.join(os.tmpdir(), "core-legacy-provider-"),
		);
		tempDirs.push(tempDir);
		const providersPath = path.join(tempDir, "provider-settings.json");
		const manager = new ProviderSettingsManager({ filePath: providersPath });

		writeFileSync(
			path.join(tempDir, "globalState.json"),
			JSON.stringify(
				{
					mode: "act",
					actModeApiProvider: "anthropic",
					actModeApiModelId: "claude-sonnet-4-6",
					anthropicBaseUrl: "https://example.invalid/anthropic",
					actModeReasoningEffort: "high",
					actModeThinkingBudgetTokens: 2048,
					requestTimeoutMs: 90000,
				},
				null,
				2,
			),
		);
		writeFileSync(
			path.join(tempDir, "secrets.json"),
			JSON.stringify({ apiKey: "legacy-anthropic-key" }, null, 2),
		);

		const result = migrateLegacyProviderSettings({
			providerSettingsManager: manager,
			dataDir: tempDir,
		});

		expect(result).toMatchObject({
			migrated: true,
			providerCount: 1,
			lastUsedProvider: "anthropic",
		});
		expect(manager.getProviderSettings("anthropic")).toEqual({
			provider: "anthropic",
			model: "claude-sonnet-4-6",
			apiKey: "legacy-anthropic-key",
			baseUrl: "https://example.invalid/anthropic",
			timeout: 90000,
			reasoning: {
				effort: "high",
				budgetTokens: 2048,
			},
		});
		expect(manager.read().providers.anthropic?.tokenSource).toBe("migration");
	});

	it("migrates legacy OCA-specific reasoning effort into provider settings", () => {
		const tempDir = mkdtempSync(
			path.join(os.tmpdir(), "core-legacy-provider-"),
		);
		tempDirs.push(tempDir);
		const providersPath = path.join(tempDir, "provider-settings.json");
		const manager = new ProviderSettingsManager({ filePath: providersPath });

		writeFileSync(
			path.join(tempDir, "globalState.json"),
			JSON.stringify(
				{
					mode: "plan",
					planModeApiProvider: "oca",
					actModeReasoningEffort: "low",
					planModeOcaReasoningEffort: "high",
					actModeOcaReasoningEffort: "medium",
				},
				null,
				2,
			),
		);
		writeFileSync(
			path.join(tempDir, "secrets.json"),
			JSON.stringify({ ocaApiKey: "legacy-oca-key" }, null, 2),
		);

		migrateLegacyProviderSettings({
			providerSettingsManager: manager,
			dataDir: tempDir,
		});

		expect(manager.getProviderSettings("oca")?.reasoning).toEqual({
			effort: "medium",
		});
	});

	it("migrates missing providers without overwriting existing providers", () => {
		const tempDir = mkdtempSync(
			path.join(os.tmpdir(), "core-legacy-provider-"),
		);
		tempDirs.push(tempDir);
		const providersPath = path.join(tempDir, "provider-settings.json");
		const manager = new ProviderSettingsManager({ filePath: providersPath });

		manager.saveProviderSettings({
			provider: "openai",
			model: "gpt-5",
			apiKey: "already-migrated",
		});
		writeFileSync(
			path.join(tempDir, "globalState.json"),
			JSON.stringify(
				{
					mode: "act",
					actModeApiProvider: "anthropic",
				},
				null,
				2,
			),
		);
		writeFileSync(
			path.join(tempDir, "secrets.json"),
			JSON.stringify({ apiKey: "legacy-key" }, null, 2),
		);

		const result = migrateLegacyProviderSettings({
			providerSettingsManager: manager,
			dataDir: tempDir,
		});

		expect(result.migrated).toBe(true);
		expect(manager.getProviderSettings("openai")?.apiKey).toBe(
			"already-migrated",
		);
		expect(manager.getProviderSettings("anthropic")).toEqual({
			provider: "anthropic",
			model: "claude-fable-5",
			apiKey: "legacy-key",
		});
		expect(manager.read().providers.openai?.tokenSource).toBe("manual");
		expect(manager.read().providers.anthropic?.tokenSource).toBe("migration");
	});

	it("migrates legacy OpenAI Codex OAuth credentials", () => {
		const tempDir = mkdtempSync(
			path.join(os.tmpdir(), "core-legacy-provider-"),
		);
		tempDirs.push(tempDir);
		const providersPath = path.join(tempDir, "provider-settings.json");
		const manager = new ProviderSettingsManager({ filePath: providersPath });

		writeFileSync(
			path.join(tempDir, "globalState.json"),
			JSON.stringify(
				{
					mode: "act",
					actModeApiProvider: "openai-codex",
				},
				null,
				2,
			),
		);
		writeFileSync(
			path.join(tempDir, "secrets.json"),
			JSON.stringify(
				{
					"openai-codex-oauth-credentials": JSON.stringify({
						type: "openai-codex",
						access_token: "legacy-access",
						refresh_token: "legacy-refresh",
						expires: Date.now() + 60_000,
						accountId: "acct_123",
					}),
				},
				null,
				2,
			),
		);

		const result = migrateLegacyProviderSettings({
			providerSettingsManager: manager,
			dataDir: tempDir,
		});

		expect(result).toMatchObject({
			migrated: true,
			lastUsedProvider: "openai-codex",
		});
		expect(manager.getProviderSettings("openai-codex")).toEqual({
			provider: "openai-codex",
			apiKey: "legacy-access",
			auth: {
				accessToken: "legacy-access",
				refreshToken: "legacy-refresh",
				accountId: "acct_123",
			},
		});
		expect(manager.read().providers["openai-codex"]?.tokenSource).toBe(
			"migration",
		);
	});

	it("migrates legacy Cline OAuth account auth even without a clineApiKey", () => {
		const tempDir = mkdtempSync(
			path.join(os.tmpdir(), "core-legacy-provider-"),
		);
		tempDirs.push(tempDir);
		const providersPath = path.join(tempDir, "provider-settings.json");
		const manager = new ProviderSettingsManager({ filePath: providersPath });

		writeFileSync(
			path.join(tempDir, "globalState.json"),
			JSON.stringify(
				{
					mode: "act",
					actModeApiProvider: "anthropic",
				},
				null,
				2,
			),
		);
		writeFileSync(
			path.join(tempDir, "secrets.json"),
			JSON.stringify(
				{
					"cline:clineAccountId": makeClineAccountJson({
						idToken: "legacy-cline-access",
						refreshToken: "legacy-cline-refresh",
						expiresAt: 1_750_000_000,
						userId: "user-123",
					}),
				},
				null,
				2,
			),
		);

		const result = migrateLegacyProviderSettings({
			providerSettingsManager: manager,
			dataDir: tempDir,
		});

		expect(result.migrated).toBe(true);
		expect(manager.getProviderSettings("cline")?.auth).toEqual({
			accessToken: "legacy-cline-access",
			refreshToken: "legacy-cline-refresh",
			expiresAt: 1_750_000_000_000,
			accountId: "user-123",
		});
		expect(manager.read().providers.cline?.tokenSource).toBe("migration");
	});

	it("migrates legacy OpenAI-compatible config into the openai-compatible provider", () => {
		const tempDir = mkdtempSync(
			path.join(os.tmpdir(), "core-legacy-provider-"),
		);
		tempDirs.push(tempDir);
		const providersPath = path.join(tempDir, "settings", "providers.json");
		const manager = new ProviderSettingsManager({ filePath: providersPath });

		writeFileSync(
			path.join(tempDir, "globalState.json"),
			JSON.stringify(
				{
					mode: "act",
					actModeApiProvider: "openai",
					actModeOpenAiModelId: "gpt-oss-120b",
					openAiBaseUrl: "https://gateway.example.invalid/v1",
					openAiHeaders: {
						"X-Test": "legacy-header",
					},
					requestTimeoutMs: 45000,
				},
				null,
				2,
			),
		);
		writeFileSync(
			path.join(tempDir, "secrets.json"),
			JSON.stringify({ openAiApiKey: "legacy-openai-compatible-key" }, null, 2),
		);

		const result = migrateLegacyProviderSettings({
			providerSettingsManager: manager,
			dataDir: tempDir,
		});

		expect(result).toMatchObject({
			migrated: true,
			providerCount: 1,
			lastUsedProvider: "openai-compatible",
		});
		expect(manager.getProviderSettings("openai-compatible")).toEqual({
			provider: "openai-compatible",
			model: "gpt-oss-120b",
			apiKey: "legacy-openai-compatible-key",
			baseUrl: "https://gateway.example.invalid/v1",
			headers: {
				"X-Test": "legacy-header",
			},
			timeout: 45000,
		});

		const modelsPath = path.join(tempDir, "settings", "models.json");
		expect(JSON.parse(readFileSync(modelsPath, "utf8"))).toEqual({
			version: 1,
			providers: {
				"openai-compatible": {
					provider: {
						name: "OpenAI Compatible",
						baseUrl: "https://gateway.example.invalid/v1",
						defaultModelId: "gpt-oss-120b",
					},
					models: {
						"gpt-oss-120b": {
							id: "gpt-oss-120b",
							name: "gpt-oss-120b",
							contextWindow: 128000,
							maxInputTokens: 128000,
							capabilities: ["streaming", "tools", "images"],
						},
					},
				},
			},
		});
	});

	it("keeps official OpenAI endpoints under the built-in openai-compatible provider", () => {
		const tempDir = mkdtempSync(
			path.join(os.tmpdir(), "core-legacy-provider-"),
		);
		tempDirs.push(tempDir);
		const providersPath = path.join(tempDir, "settings", "providers.json");
		const manager = new ProviderSettingsManager({ filePath: providersPath });

		writeFileSync(
			path.join(tempDir, "globalState.json"),
			JSON.stringify(
				{
					mode: "act",
					actModeApiProvider: "openai",
					actModeOpenAiModelId: "gpt-5",
					openAiBaseUrl: "https://api.openai.com/v1",
				},
				null,
				2,
			),
		);
		writeFileSync(
			path.join(tempDir, "secrets.json"),
			JSON.stringify({ openAiApiKey: "legacy-openai-key" }, null, 2),
		);

		const result = migrateLegacyProviderSettings({
			providerSettingsManager: manager,
			dataDir: tempDir,
		});

		expect(result).toMatchObject({
			migrated: true,
			providerCount: 1,
			lastUsedProvider: "openai-compatible",
		});
		expect(manager.getProviderSettings("openai-compatible")).toEqual({
			provider: "openai-compatible",
			model: "gpt-5",
			apiKey: "legacy-openai-key",
			baseUrl: "https://api.openai.com/v1",
		});
		expect(manager.getProviderSettings("openai")).toBeUndefined();
	});

	it("migrates Bedrock profile auth profile names without requiring legacy awsUseProfile", () => {
		const tempDir = mkdtempSync(
			path.join(os.tmpdir(), "core-legacy-provider-"),
		);
		tempDirs.push(tempDir);
		const providersPath = path.join(tempDir, "provider-settings.json");
		const manager = new ProviderSettingsManager({ filePath: providersPath });

		writeFileSync(
			path.join(tempDir, "globalState.json"),
			JSON.stringify(
				{
					mode: "act",
					actModeApiProvider: "bedrock",
					actModeApiModelId: "global.anthropic.claude-opus-4-6-v1",
					awsRegion: "us-east-1",
					awsAuthentication: "profile",
					awsProfile: "bedrock",
					awsBedrockUsePromptCache: true,
					awsUseCrossRegionInference: true,
					awsUseGlobalInference: false,
					actModeAwsBedrockCustomModelBaseId:
						"anthropic.claude-sonnet-4-5-20250929-v1:0",
				},
				null,
				2,
			),
		);
		writeFileSync(path.join(tempDir, "secrets.json"), JSON.stringify({}));

		const result = migrateLegacyProviderSettings({
			providerSettingsManager: manager,
			dataDir: tempDir,
		});

		expect(result).toMatchObject({
			migrated: true,
			providerCount: 1,
			lastUsedProvider: "bedrock",
		});
		expect(manager.getProviderSettings("bedrock")).toEqual({
			provider: "bedrock",
			model: "global.anthropic.claude-opus-4-6-v1",
			aws: {
				region: "us-east-1",
				authentication: "profile",
				profile: "bedrock",
				usePromptCache: true,
				useCrossRegionInference: true,
				useGlobalInference: false,
				customModelBaseId: "anthropic.claude-sonnet-4-5-20250929-v1:0",
			},
		});
		expect(manager.read().providers.bedrock?.tokenSource).toBe("migration");
	});

	it("normalizes legacy Bedrock credentials auth to SDK iam auth", () => {
		const tempDir = mkdtempSync(
			path.join(os.tmpdir(), "core-legacy-provider-"),
		);
		tempDirs.push(tempDir);
		const providersPath = path.join(tempDir, "provider-settings.json");
		const manager = new ProviderSettingsManager({ filePath: providersPath });

		writeFileSync(
			path.join(tempDir, "globalState.json"),
			JSON.stringify(
				{
					mode: "act",
					actModeApiProvider: "bedrock",
					actModeApiModelId: "anthropic.claude-haiku-4-5-20251001-v1:0",
					awsRegion: "us-east-1",
					awsAuthentication: "credentials",
				},
				null,
				2,
			),
		);
		writeFileSync(
			path.join(tempDir, "secrets.json"),
			JSON.stringify({ awsAccessKey: "access", awsSecretKey: "secret" }),
		);

		const result = migrateLegacyProviderSettings({
			providerSettingsManager: manager,
			dataDir: tempDir,
		});

		expect(result).toMatchObject({ migrated: true, providerCount: 1 });
		expect(manager.getProviderSettings("bedrock")?.aws).toMatchObject({
			authentication: "iam",
			accessKey: "access",
			secretKey: "secret",
			region: "us-east-1",
		});
	});

	it("migrates legacy SAP AI Core credentials into SAP provider settings", () => {
		const tempDir = mkdtempSync(
			path.join(os.tmpdir(), "core-legacy-provider-"),
		);
		tempDirs.push(tempDir);
		const providersPath = path.join(tempDir, "settings", "providers.json");
		const manager = new ProviderSettingsManager({ filePath: providersPath });

		writeFileSync(
			path.join(tempDir, "globalState.json"),
			JSON.stringify(
				{
					mode: "act",
					actModeApiProvider: "sapaicore",
					actModeApiModelId: "anthropic--claude-4.6-sonnet",
					sapAiCoreBaseUrl: "https://api.ai.example.aws.ml.hana.ondemand.com",
					sapAiCoreTokenUrl:
						"https://example.authentication.sap.hana.ondemand.com",
					sapAiResourceGroup: "default",
					sapAiCoreUseOrchestrationMode: true,
					actModeSapAiCoreDeploymentId: "deployment-id",
				},
				null,
				2,
			),
		);
		writeFileSync(
			path.join(tempDir, "secrets.json"),
			JSON.stringify(
				{
					sapAiCoreClientId: "sap-client",
					sapAiCoreClientSecret: "sap-secret",
				},
				null,
				2,
			),
		);

		const result = migrateLegacyProviderSettings({
			providerSettingsManager: manager,
			dataDir: tempDir,
		});

		expect(result).toMatchObject({
			migrated: true,
			providerCount: 1,
			lastUsedProvider: "sapaicore",
		});
		expect(manager.getProviderSettings("sapaicore")).toEqual({
			provider: "sapaicore",
			model: "anthropic--claude-4.6-sonnet",
			baseUrl: "https://api.ai.example.aws.ml.hana.ondemand.com",
			sap: {
				clientId: "sap-client",
				clientSecret: "sap-secret",
				tokenUrl: "https://example.authentication.sap.hana.ondemand.com",
				resourceGroup: "default",
				deploymentId: "deployment-id",
				useOrchestrationMode: true,
			},
		});
		expect(manager.read().providers.sapaicore?.tokenSource).toBe("migration");
	});

	it("detects SAP AI Core legacy files even when provider mode is absent", () => {
		const tempDir = mkdtempSync(
			path.join(os.tmpdir(), "core-legacy-provider-"),
		);
		tempDirs.push(tempDir);
		const providersPath = path.join(tempDir, "settings", "providers.json");
		const manager = new ProviderSettingsManager({ filePath: providersPath });

		writeFileSync(
			path.join(tempDir, "globalState.json"),
			JSON.stringify(
				{
					sapAiCoreBaseUrl: "https://api.ai.example.aws.ml.hana.ondemand.com",
					sapAiCoreTokenUrl:
						"https://example.authentication.sap.hana.ondemand.com",
				},
				null,
				2,
			),
		);
		writeFileSync(
			path.join(tempDir, "secrets.json"),
			JSON.stringify(
				{
					sapAiCoreClientId: "sap-client",
					sapAiCoreClientSecret: "sap-secret",
				},
				null,
				2,
			),
		);

		const result = migrateLegacyProviderSettings({
			providerSettingsManager: manager,
			dataDir: tempDir,
		});

		expect(result).toMatchObject({
			migrated: true,
			lastUsedProvider: "sapaicore",
		});
		expect(manager.getProviderSettings("sapaicore")).toMatchObject({
			provider: "sapaicore",
			baseUrl: "https://api.ai.example.aws.ml.hana.ondemand.com",
			sap: {
				clientId: "sap-client",
				clientSecret: "sap-secret",
				tokenUrl: "https://example.authentication.sap.hana.ondemand.com",
			},
		});
	});
});

// =============================================================================
// resolveLegacyClineAuth – pure in-memory tests
// =============================================================================

/** Builds a realistic LegacyClineUserInfo JSON string. */
function makeClineAccountJson(
	overrides: Partial<LegacyClineUserInfo> & { userId?: string } = {},
): string {
	return JSON.stringify({
		idToken: overrides.idToken ?? "id-token-abc",
		expiresAt: overrides.expiresAt ?? 1750000000000,
		refreshToken: overrides.refreshToken ?? "refresh-token-xyz",
		userInfo: overrides.userInfo ?? {
			id: overrides.userId ?? "user-42",
			email: "test@example.com",
			displayName: "Test User",
			termsAcceptedAt: "2025-01-01T00:00:00Z",
			clineBenchConsent: false,
			createdAt: "2025-01-01T00:00:00Z",
			updatedAt: "2025-01-01T00:00:00Z",
		},
		provider: overrides.provider ?? "google",
		startedAt: overrides.startedAt ?? Date.now(),
	} satisfies LegacyClineUserInfo);
}

describe("resolveLegacyClineAuth", () => {
	it("extracts all auth fields from a complete legacy account JSON", () => {
		const result = resolveLegacyClineAuth(
			makeClineAccountJson({
				idToken: "my-id-token",
				expiresAt: 1750000000000,
				refreshToken: "my-refresh",
				userId: "user-123",
			}),
		);

		expect(result).toEqual({
			accessToken: "my-id-token",
			refreshToken: "my-refresh",
			expiresAt: 1750000000000,
			accountId: "user-123",
		});
	});

	it("maps idToken to accessToken", () => {
		const result = resolveLegacyClineAuth(
			makeClineAccountJson({ idToken: "tok-abc" }),
		);
		expect(result?.accessToken).toBe("tok-abc");
	});

	it("preserves millisecond expiresAt values", () => {
		const result = resolveLegacyClineAuth(
			makeClineAccountJson({ expiresAt: 9999999999999 }),
		);
		expect(result?.expiresAt).toBe(9999999999999);
		expect(typeof result?.expiresAt).toBe("number");
	});

	it("normalizes classic second-based expiresAt values to milliseconds", () => {
		const result = resolveLegacyClineAuth(
			makeClineAccountJson({ expiresAt: 1_750_000_000 }),
		);
		expect(result?.expiresAt).toBe(1_750_000_000_000);
	});

	it("maps userInfo.id to accountId", () => {
		const result = resolveLegacyClineAuth(
			makeClineAccountJson({ userId: "uid-xyz" }),
		);
		expect(result?.accountId).toBe("uid-xyz");
	});

	it("returns undefined accountId when userInfo is missing entirely", () => {
		const raw = JSON.stringify({
			idToken: "tok",
			expiresAt: 1000,
			refreshToken: "ref",
			provider: "google",
			startedAt: 1,
		});

		const result = resolveLegacyClineAuth(raw);
		expect(result).toBeDefined();
		expect(result?.accessToken).toBe("tok");
		expect(result?.accountId).toBeUndefined();
	});

	it("returns undefined accountId when userInfo.id is missing", () => {
		const raw = JSON.stringify({
			idToken: "tok",
			expiresAt: 1000,
			refreshToken: "ref",
			userInfo: {
				email: "x@y.com",
				displayName: "X",
				termsAcceptedAt: "2025-01-01T00:00:00Z",
				clineBenchConsent: false,
				createdAt: "2025-01-01T00:00:00Z",
				updatedAt: "2025-01-01T00:00:00Z",
			},
			provider: "google",
			startedAt: 1,
		});

		const result = resolveLegacyClineAuth(raw);
		expect(result).toBeDefined();
		expect(result?.accountId).toBeUndefined();
	});

	it("returns undefined for invalid json", () => {
		expect(resolveLegacyClineAuth(undefined)).toBeUndefined();
		expect(resolveLegacyClineAuth("")).toBeUndefined();
		expect(resolveLegacyClineAuth("   \n\t  ")).toBeUndefined();
		expect(resolveLegacyClineAuth("not-json{{{")).toBeUndefined();
		expect(resolveLegacyClineAuth("null")).toBeUndefined();
	});

	it("returns undefined fields when idToken/refreshToken are missing from JSON", () => {
		const raw = JSON.stringify({
			userInfo: { id: "uid" },
			provider: "google",
			startedAt: 1,
		});

		const result = resolveLegacyClineAuth(raw);
		expect(result).toBeDefined();
		expect(result?.accessToken).toBeUndefined();
		expect(result?.refreshToken).toBeUndefined();
		expect(result?.expiresAt).toBeUndefined();
		expect(result?.accountId).toBe("uid");
	});
});
