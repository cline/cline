import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import * as LlmsModels from "@cline/llms";
import { afterEach, describe, expect, it } from "vitest";
import { ProviderSettingsManager } from "./provider-settings-manager";

describe("ProviderSettingsManager", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		LlmsModels.resetRegistry();
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("persists and restores provider settings", () => {
		const tempDir = mkdtempSync(
			path.join(os.tmpdir(), "core-provider-settings-"),
		);
		tempDirs.push(tempDir);
		const filePath = path.join(tempDir, "provider-settings.json");
		const manager = new ProviderSettingsManager({ filePath });

		manager.saveProviderSettings(
			{
				provider: "anthropic",
				model: "claude-sonnet-4-6",
				apiKey: "test-key",
			},
			{ setLastUsed: true },
		);

		const reloaded = new ProviderSettingsManager({ filePath });
		expect(reloaded.getLastUsedProviderSettings()).toEqual({
			provider: "anthropic",
			model: "claude-sonnet-4-6",
			apiKey: "test-key",
		});
		expect(reloaded.getProviderConfig("anthropic")?.providerId).toBe(
			"anthropic",
		);
		expect(reloaded.getProviderConfig("anthropic")?.modelId).toBe(
			"claude-sonnet-4-6",
		);
		expect(reloaded.getProviderConfig("anthropic")?.knownModels).toBeDefined();
		expect(
			reloaded.getProviderConfig("anthropic", { includeKnownModels: false }),
		).not.toHaveProperty("knownModels");
		expect(reloaded.read().providers.anthropic?.tokenSource).toBe("manual");
	});

	it("writes atomically, leaving no temp file behind", () => {
		const tempDir = mkdtempSync(
			path.join(os.tmpdir(), "core-provider-settings-"),
		);
		tempDirs.push(tempDir);
		const filePath = path.join(tempDir, "provider-settings.json");
		const manager = new ProviderSettingsManager({ filePath });

		manager.saveProviderSettings(
			{ provider: "anthropic", apiKey: "test-key" },
			{ setLastUsed: true },
		);

		const siblings = readdirSync(tempDir);
		expect(siblings).toEqual(["provider-settings.json"]);
	});

	it("preserves the previous file when the staged write cannot be renamed", () => {
		const tempDir = mkdtempSync(
			path.join(os.tmpdir(), "core-provider-settings-"),
		);
		tempDirs.push(tempDir);
		const filePath = path.join(tempDir, "provider-settings.json");
		const manager = new ProviderSettingsManager({ filePath });
		manager.saveProviderSettings(
			{ provider: "anthropic", apiKey: "before" },
			{ setLastUsed: true },
		);
		const before = readFileSync(filePath, "utf8");

		// Occupying the temp path with a directory makes writeFileSync fail,
		// simulating a mid-write crash: the destination must be untouched.
		mkdirSync(`${filePath}.${process.pid}.tmp`);
		expect(() =>
			manager.saveProviderSettings(
				{ provider: "anthropic", apiKey: "after" },
				{ setLastUsed: true },
			),
		).toThrow();
		rmSync(`${filePath}.${process.pid}.tmp`, { recursive: true, force: true });

		expect(readFileSync(filePath, "utf8")).toBe(before);
	});

	it("resolves auth storage settings for providers registered with a storage provider id", () => {
		const tempDir = mkdtempSync(
			path.join(os.tmpdir(), "core-provider-settings-"),
		);
		tempDirs.push(tempDir);
		const filePath = path.join(tempDir, "provider-settings.json");
		const manager = new ProviderSettingsManager({ filePath });

		manager.saveProviderSettings(
			{
				provider: "cline",
				model: "anthropic/claude-sonnet-4.6",
				baseUrl: "https://api.example.test",
				auth: {
					accessToken: "workos:shared-token",
					refreshToken: "shared-refresh",
				},
			},
			{ setLastUsed: false, tokenSource: "oauth" },
		);

		expect(manager.getProviderSettings("cline-pass")).toEqual({
			provider: "cline-pass",
			baseUrl: "https://api.example.test",
			auth: {
				accessToken: "workos:shared-token",
				refreshToken: "shared-refresh",
			},
		});
		expect(manager.getProviderConfig("cline-pass")).toMatchObject({
			providerId: "cline-pass",
			apiKey: "workos:shared-token",
			baseUrl: "https://api.example.test",
		});

		manager.saveProviderSettings(
			{
				provider: "cline-pass",
				model: "cline-pass/glm-5.2",
			},
			{ setLastUsed: true },
		);

		expect(manager.getProviderSettings("cline-pass")).toEqual({
			provider: "cline-pass",
			model: "cline-pass/glm-5.2",
			baseUrl: "https://api.example.test",
			auth: {
				accessToken: "workos:shared-token",
				refreshToken: "shared-refresh",
			},
		});
	});

	it("falls back to cline when last-used provider is cline-pass and the feature is disabled", () => {
		const tempDir = mkdtempSync(
			path.join(os.tmpdir(), "core-provider-settings-"),
		);
		tempDirs.push(tempDir);
		const filePath = path.join(tempDir, "provider-settings.json");
		const manager = new ProviderSettingsManager({ filePath });

		manager.saveProviderSettings(
			{
				provider: "cline",
				model: "anthropic/claude-sonnet-4.6",
				baseUrl: "https://api.example.test",
				auth: {
					accessToken: "workos:shared-token",
					refreshToken: "shared-refresh",
				},
			},
			{ setLastUsed: false, tokenSource: "oauth" },
		);
		manager.saveProviderSettings(
			{
				provider: "cline-pass",
				model: "cline-pass/glm-5.2",
			},
			{ setLastUsed: true },
		);

		expect(manager.getLastUsedProviderSettings()).toMatchObject({
			provider: "cline-pass",
			model: "cline-pass/glm-5.2",
		});
		expect(
			manager.getLastUsedProviderSettings({ isClinePassEnabled: false }),
		).toEqual({
			provider: "cline",
			model: "anthropic/claude-sonnet-4.6",
			baseUrl: "https://api.example.test",
			auth: {
				accessToken: "workos:shared-token",
				refreshToken: "shared-refresh",
			},
		});
		expect(
			manager.getLastUsedProviderConfig({ isClinePassEnabled: false }),
		).toMatchObject({
			providerId: "cline",
			apiKey: "workos:shared-token",
			baseUrl: "https://api.example.test",
		});
	});

	it("returns default cline settings when cline-pass is last-used and no cline settings exist", () => {
		const tempDir = mkdtempSync(
			path.join(os.tmpdir(), "core-provider-settings-"),
		);
		tempDirs.push(tempDir);
		const filePath = path.join(tempDir, "provider-settings.json");
		const manager = new ProviderSettingsManager({ filePath });

		manager.saveProviderSettings(
			{
				provider: "cline-pass",
				model: "cline-pass/glm-5.2",
			},
			{ setLastUsed: true },
		);

		manager.saveProviderSettings(
			{
				provider: "cline",
			},
			{ setLastUsed: true },
		);

		expect(
			manager.getLastUsedProviderSettings({ isClinePassEnabled: false }),
		).toEqual({ provider: "cline" });
		expect(
			manager.getLastUsedProviderConfig({ isClinePassEnabled: false })
				?.providerId,
		).toBe("cline");
	});

	it("migrates legacy provider settings during manager construction", () => {
		const tempDir = mkdtempSync(
			path.join(os.tmpdir(), "core-provider-settings-"),
		);
		tempDirs.push(tempDir);
		const filePath = path.join(tempDir, "settings", "providers.json");

		writeFileSync(
			path.join(tempDir, "globalState.json"),
			JSON.stringify(
				{
					mode: "act",
					actModeApiProvider: "anthropic",
					actModeApiModelId: "claude-sonnet-4-6",
				},
				null,
				2,
			),
		);
		writeFileSync(
			path.join(tempDir, "secrets.json"),
			JSON.stringify({ apiKey: "legacy-key" }, null, 2),
		);

		const manager = new ProviderSettingsManager({ filePath, dataDir: tempDir });

		expect(manager.getLastUsedProviderSettings()).toEqual({
			provider: "anthropic",
			model: "claude-sonnet-4-6",
			apiKey: "legacy-key",
		});
		expect(manager.read().providers.anthropic?.tokenSource).toBe("migration");
	});

	it("registers migrated custom providers during manager construction", async () => {
		const tempDir = mkdtempSync(
			path.join(os.tmpdir(), "core-provider-settings-"),
		);
		tempDirs.push(tempDir);
		const filePath = path.join(tempDir, "settings", "providers.json");

		writeFileSync(
			path.join(tempDir, "globalState.json"),
			JSON.stringify(
				{
					mode: "act",
					actModeApiProvider: "openai",
					actModeOpenAiModelId: "gpt-oss-120b",
					openAiBaseUrl: "https://gateway.example.invalid/v1",
				},
				null,
				2,
			),
		);
		writeFileSync(
			path.join(tempDir, "secrets.json"),
			JSON.stringify({ openAiApiKey: "legacy-key" }, null, 2),
		);

		const manager = new ProviderSettingsManager({ filePath, dataDir: tempDir });
		const providers = await LlmsModels.getAllProviders();
		const models = await LlmsModels.getModelsForProvider("openai-compatible");
		const openAiProvider = providers.find(
			(provider) => provider.id === "openai-compatible",
		);

		expect(manager.getProviderSettings("openai-compatible")).toEqual({
			provider: "openai-compatible",
			model: "gpt-oss-120b",
			apiKey: "legacy-key",
			baseUrl: "https://gateway.example.invalid/v1",
		});
		expect(openAiProvider).toMatchObject({
			id: "openai-compatible",
			baseUrl: "https://gateway.example.invalid/v1",
			defaultModelId: "gpt-oss-120b",
		});
		expect(models["gpt-oss-120b"]).toMatchObject({
			id: "gpt-oss-120b",
			contextWindow: 128000,
			maxInputTokens: 128000,
			capabilities: ["streaming", "tools", "images"],
		});
	});

	it("registers non-built-in OpenAI-compatible providers from providers.json", async () => {
		const tempDir = mkdtempSync(
			path.join(os.tmpdir(), "core-provider-settings-"),
		);
		tempDirs.push(tempDir);
		const filePath = path.join(tempDir, "settings", "providers.json");
		mkdirSync(path.dirname(filePath), { recursive: true });
		writeFileSync(
			filePath,
			JSON.stringify(
				{
					version: 1,
					lastUsedProvider: "custom-provider",
					providers: {
						"custom-provider": {
							settings: {
								provider: "custom-provider",
								baseUrl: "https://custom.example.invalid/v1",
								model: "custom-model",
								apiKey: "test-key",
								capabilities: ["reasoning", "tools"],
							},
							updatedAt: new Date().toISOString(),
							tokenSource: "manual",
						},
					},
				},
				null,
				2,
			),
		);

		const manager = new ProviderSettingsManager({ filePath });
		const provider = await LlmsModels.getProvider("custom-provider");
		const models = await LlmsModels.getModelsForProvider("custom-provider");

		expect(manager.getProviderConfig("custom-provider")).toMatchObject({
			providerId: "custom-provider",
			baseUrl: "https://custom.example.invalid/v1",
			modelId: "custom-model",
		});
		expect(provider).toMatchObject({
			id: "custom-provider",
			baseUrl: "https://custom.example.invalid/v1",
			defaultModelId: "custom-model",
			client: "openai-compatible",
			source: "file",
		});
		expect(models["custom-model"]).toMatchObject({
			id: "custom-model",
		});
		expect(models["custom-model"]?.capabilities?.sort()).toEqual([
			"reasoning",
			"tools",
		]);
	});

	it("routes custom providers with the Responses API protocol through the OpenAI client", async () => {
		const tempDir = mkdtempSync(
			path.join(os.tmpdir(), "core-provider-settings-"),
		);
		tempDirs.push(tempDir);
		const filePath = path.join(tempDir, "settings", "providers.json");
		mkdirSync(path.dirname(filePath), { recursive: true });
		writeFileSync(
			filePath,
			JSON.stringify(
				{
					version: 1,
					lastUsedProvider: "custom-responses",
					providers: {
						"custom-responses": {
							settings: {
								provider: "custom-responses",
								baseUrl: "https://responses.example.invalid/v1",
								model: "responses-model",
								protocol: "openai-responses",
								apiKey: "test-key",
							},
							updatedAt: new Date().toISOString(),
							tokenSource: "manual",
						},
					},
				},
				null,
				2,
			),
		);

		const manager = new ProviderSettingsManager({ filePath });
		const provider = await LlmsModels.getProvider("custom-responses");

		expect(manager.getProviderConfig("custom-responses")).toMatchObject({
			providerId: "custom-responses",
			baseUrl: "https://responses.example.invalid/v1",
			modelId: "responses-model",
			routingProviderId: "openai-native",
		});
		expect(provider).toMatchObject({
			id: "custom-responses",
			protocol: "openai-responses",
			client: "openai",
			source: "file",
		});
	});

	it("refreshes provider registrations when providers.json changes on disk", async () => {
		const tempDir = mkdtempSync(
			path.join(os.tmpdir(), "core-provider-settings-"),
		);
		tempDirs.push(tempDir);
		const filePath = path.join(tempDir, "settings", "providers.json");
		const manager = new ProviderSettingsManager({ filePath });
		mkdirSync(path.dirname(filePath), { recursive: true });

		expect(LlmsModels.hasProvider("disk-added-provider")).toBe(false);

		writeFileSync(
			filePath,
			JSON.stringify(
				{
					version: 1,
					providers: {
						"disk-added-provider": {
							settings: {
								provider: "disk-added-provider",
								baseUrl: "https://disk.example.invalid/v1",
								model: "disk-model",
							},
							updatedAt: new Date().toISOString(),
							tokenSource: "manual",
						},
					},
				},
				null,
				2,
			),
		);

		expect(manager.getProviderSettings("disk-added-provider")).toMatchObject({
			provider: "disk-added-provider",
			baseUrl: "https://disk.example.invalid/v1",
			model: "disk-model",
		});
		await expect(
			LlmsModels.getProvider("disk-added-provider"),
		).resolves.toMatchObject({
			id: "disk-added-provider",
			defaultModelId: "disk-model",
		});
	});

	it("tracks provider-specific settings while preserving last-used provider", () => {
		const tempDir = mkdtempSync(
			path.join(os.tmpdir(), "core-provider-settings-"),
		);
		tempDirs.push(tempDir);
		const filePath = path.join(tempDir, "provider-settings.json");
		const manager = new ProviderSettingsManager({ filePath });

		manager.saveProviderSettings({
			provider: "anthropic",
			model: "claude-sonnet-4-6",
		});
		manager.saveProviderSettings(
			{
				provider: "openai-native",
				model: "gpt-5",
			},
			{ setLastUsed: false },
		);

		expect(manager.getProviderSettings("anthropic")?.model).toBe(
			"claude-sonnet-4-6",
		);
		expect(manager.getProviderSettings("openai-native")?.model).toBe("gpt-5");
		expect(manager.getLastUsedProviderSettings()?.provider).toBe("anthropic");
		expect(manager.read().providers["openai-native"]?.tokenSource).toBe(
			"manual",
		);
	});

	it("allows overriding token source metadata", () => {
		const tempDir = mkdtempSync(
			path.join(os.tmpdir(), "core-provider-settings-"),
		);
		tempDirs.push(tempDir);
		const filePath = path.join(tempDir, "provider-settings.json");
		const manager = new ProviderSettingsManager({ filePath });

		manager.saveProviderSettings(
			{
				provider: "openai-codex",
				apiKey: "oauth-token",
			},
			{ tokenSource: "oauth" },
		);

		expect(manager.read().providers["openai-codex"]?.tokenSource).toBe("oauth");
	});

	it("preserves OAuth auth when updating only Cline model settings", () => {
		const tempDir = mkdtempSync(
			path.join(os.tmpdir(), "core-provider-settings-"),
		);
		tempDirs.push(tempDir);
		const filePath = path.join(tempDir, "provider-settings.json");
		const manager = new ProviderSettingsManager({ filePath });

		manager.saveProviderSettings(
			{
				provider: "cline",
				model: "anthropic/claude-sonnet-4.6",
				auth: {
					accessToken: "workos:access-old",
					refreshToken: "refresh-old",
					expiresAt: 4_000_000_000_000,
					accountId: "acct-old",
				},
			},
			{ tokenSource: "oauth" },
		);

		manager.saveProviderSettings({
			provider: "cline",
			model: "anthropic/claude-haiku-4.5",
			reasoning: { enabled: false },
		});

		expect(manager.getProviderSettings("cline")).toEqual({
			provider: "cline",
			model: "anthropic/claude-haiku-4.5",
			reasoning: { enabled: false },
			auth: {
				accessToken: "workos:access-old",
				refreshToken: "refresh-old",
				expiresAt: 4_000_000_000_000,
				accountId: "acct-old",
			},
		});
		expect(manager.read().providers.cline?.tokenSource).toBe("oauth");
	});

	it("merges partial OAuth auth updates with existing refresh metadata", () => {
		const tempDir = mkdtempSync(
			path.join(os.tmpdir(), "core-provider-settings-"),
		);
		tempDirs.push(tempDir);
		const filePath = path.join(tempDir, "provider-settings.json");
		const manager = new ProviderSettingsManager({ filePath });

		manager.saveProviderSettings(
			{
				provider: "openai-codex",
				auth: {
					accessToken: "access-old",
					refreshToken: "refresh-old",
					expiresAt: 4_000_000_000_000,
					accountId: "acct-old",
				},
			},
			{ tokenSource: "oauth" },
		);

		manager.saveProviderSettings(
			{
				provider: "openai-codex",
				auth: {
					accessToken: "access-new",
				},
			},
			{ tokenSource: "oauth" },
		);

		expect(manager.getProviderSettings("openai-codex")?.auth).toEqual({
			accessToken: "access-new",
			refreshToken: "refresh-old",
			expiresAt: 4_000_000_000_000,
			accountId: "acct-old",
		});
	});

	it("ignores invalid persisted JSON and falls back to empty state", () => {
		const tempDir = mkdtempSync(
			path.join(os.tmpdir(), "core-provider-settings-"),
		);
		tempDirs.push(tempDir);
		const filePath = path.join(tempDir, "provider-settings.json");
		writeFileSync(filePath, "{ not-json", "utf8");

		const manager = new ProviderSettingsManager({ filePath });
		expect(manager.read()).toEqual({
			version: 1,
			providers: {},
		});
	});
});
