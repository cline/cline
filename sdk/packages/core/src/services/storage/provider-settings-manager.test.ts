import { spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as LlmsModels from "@cline/llms";
import { afterEach, describe, expect, it } from "vitest";
import { ProviderSettingsManager } from "./provider-settings-manager";

const writerPath = fileURLToPath(
	new URL("./fixtures/provider-settings-writer.ts", import.meta.url),
);
const sdkDir = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../../../..",
);

function runWriter(filePath: string, iterations: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn("bun", [writerPath, filePath, String(iterations)], {
			cwd: sdkDir,
			stdio: ["ignore", "ignore", "pipe"],
		});
		let stderr = "";
		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code !== 0) {
				reject(new Error(`Writer exited ${code}: ${stderr}`));
				return;
			}
			resolve();
		});
	});
}

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

	it("preserves durable OpenAI Codex OAuth auth during ordinary settings writes", () => {
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
					expiresAt: Date.now() - 1_000,
				},
			},
			{ tokenSource: "oauth" },
		);
		const staleState = manager.read();
		manager.saveProviderSettings(
			{
				provider: "openai-codex",
				auth: {
					accessToken: "access-new",
					refreshToken: "refresh-new",
					expiresAt: Date.now() + 3_600_000,
				},
			},
			{ tokenSource: "oauth" },
		);

		const persisted = manager.saveProviderSettings({
			provider: "openai-codex",
			model: "gpt-5.4",
			auth: {
				accessToken: "access-old",
				refreshToken: "refresh-old",
				expiresAt: Date.now() - 1_000,
			},
		});

		expect(persisted.providers["openai-codex"]?.settings.auth).toMatchObject({
			accessToken: "access-new",
			refreshToken: "refresh-new",
		});
		expect(manager.getProviderSettings("openai-codex")).toMatchObject({
			model: "gpt-5.4",
			auth: {
				accessToken: "access-new",
				refreshToken: "refresh-new",
			},
		});
		manager.write(staleState);
		expect(manager.getProviderSettings("openai-codex")?.auth).toMatchObject({
			accessToken: "access-new",
			refreshToken: "refresh-new",
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

	it("recovers a replacement backup when the primary settings file is absent", () => {
		const tempDir = mkdtempSync(
			path.join(os.tmpdir(), "core-provider-settings-"),
		);
		tempDirs.push(tempDir);
		const filePath = path.join(tempDir, "settings", "providers.json");
		mkdirSync(path.dirname(filePath), { recursive: true });
		writeFileSync(
			`${filePath}.backup`,
			JSON.stringify({
				version: 1,
				providers: {
					anthropic: {
						settings: {
							provider: "anthropic",
							model: "backup-model",
						},
						updatedAt: new Date().toISOString(),
						tokenSource: "manual",
					},
				},
			}),
		);

		const manager = new ProviderSettingsManager({ filePath });
		expect(manager.getProviderSettings("anthropic")?.model).toBe(
			"backup-model",
		);

		manager.saveProviderSettings({
			provider: "anthropic",
			model: "new-model",
		});

		expect(existsSync(filePath)).toBe(true);
		expect(existsSync(`${filePath}.backup`)).toBe(false);
		expect(manager.getProviderSettings("anthropic")?.model).toBe("new-model");
	});

	it("keeps providers.json parseable during concurrent writes", async () => {
		const tempDir = mkdtempSync(
			path.join(os.tmpdir(), "core-provider-settings-"),
		);
		tempDirs.push(tempDir);
		const filePath = path.join(tempDir, "settings", "providers.json");
		const manager = new ProviderSettingsManager({ filePath });
		manager.saveProviderSettings({
			provider: "anthropic",
			model: "initial",
			apiKey: "initial",
		});
		let reads = 0;
		let complete = false;
		const completed = runWriter(filePath, 30).then(() => {
			complete = true;
		});

		while (!complete) {
			if (existsSync(filePath)) {
				expect(() => JSON.parse(readFileSync(filePath, "utf8"))).not.toThrow();
				reads += 1;
			}
			await new Promise((resolve) => setTimeout(resolve, 1));
		}
		await completed;
		expect(reads).toBeGreaterThan(0);
		expect(manager.getProviderSettings("anthropic")?.model).toBe("model-29");
	}, 15_000);

	it("serializes concurrent settings writers", async () => {
		const tempDir = mkdtempSync(
			path.join(os.tmpdir(), "core-provider-settings-"),
		);
		tempDirs.push(tempDir);
		const filePath = path.join(tempDir, "settings", "providers.json");
		const manager = new ProviderSettingsManager({ filePath });

		await Promise.all([runWriter(filePath, 30), runWriter(filePath, 30)]);

		expect(() => JSON.parse(readFileSync(filePath, "utf8"))).not.toThrow();
		expect(manager.getProviderSettings("anthropic")?.model).toBe("model-29");
	}, 15_000);
});
