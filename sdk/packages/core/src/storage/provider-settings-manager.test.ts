import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as LlmsModels from "@clinebot/llms/models";
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
		const openAiProvider = providers.find(
			(provider) => provider.id === "openai",
		);

		expect(manager.getProviderSettings("openai")).toEqual({
			provider: "openai",
			model: "gpt-oss-120b",
			apiKey: "legacy-key",
			baseUrl: "https://gateway.example.invalid/v1",
		});
		expect(openAiProvider).toMatchObject({
			id: "openai",
			baseUrl: "https://gateway.example.invalid/v1",
			defaultModelId: "gpt-oss-120b",
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
