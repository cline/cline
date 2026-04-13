import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { getProviderSettingsManager, migrateProviders } from "./provider-migration"

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let tempDir: string

beforeEach(() => {
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cline-provider-migration-"))
})

afterEach(() => {
	fs.rmSync(tempDir, { recursive: true, force: true })
})

function writeJson(filePath: string, data: unknown): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true })
	fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
}

// ---------------------------------------------------------------------------
// migrateProviders
// ---------------------------------------------------------------------------

describe("migrateProviders", () => {
	it("returns empty result when no legacy state exists", () => {
		const result = migrateProviders(tempDir)
		expect(result.migrated).toBe(false)
		expect(result.providerCount).toBe(0)
	})

	it("migrates Anthropic provider from legacy state", () => {
		writeJson(path.join(tempDir, "globalState.json"), {
			mode: "act",
			actModeApiProvider: "anthropic",
			actModeApiModelId: "claude-sonnet-4-6",
		})
		writeJson(path.join(tempDir, "secrets.json"), {
			apiKey: "sk-ant-legacy-key",
		})

		const result = migrateProviders(tempDir)
		expect(result.migrated).toBe(true)
		expect(result.providerCount).toBe(1)
		expect(result.lastUsedProvider).toBe("anthropic")

		// Verify the provider settings were written correctly
		const manager = getProviderSettingsManager(tempDir)
		const settings = manager.getProviderSettings("anthropic")
		expect(settings?.provider).toBe("anthropic")
		expect(settings?.apiKey).toBe("sk-ant-legacy-key")
		expect(settings?.model).toBe("claude-sonnet-4-6")
	})

	it("migrates OpenAI provider with base URL and headers", () => {
		writeJson(path.join(tempDir, "globalState.json"), {
			mode: "act",
			actModeApiProvider: "openai",
			actModeOpenAiModelId: "gpt-4o",
			openAiBaseUrl: "https://api.openai.com/v1",
			openAiHeaders: { "X-Custom": "test" },
			requestTimeoutMs: 30000,
		})
		writeJson(path.join(tempDir, "secrets.json"), {
			openAiApiKey: "sk-openai-legacy",
		})

		const result = migrateProviders(tempDir)
		expect(result.migrated).toBe(true)
		expect(result.lastUsedProvider).toBe("openai")

		const manager = getProviderSettingsManager(tempDir)
		const settings = manager.getProviderSettings("openai")
		expect(settings?.provider).toBe("openai")
		expect(settings?.apiKey).toBe("sk-openai-legacy")
		expect(settings?.model).toBe("gpt-4o")
	})

	it("migrates OpenRouter provider", () => {
		writeJson(path.join(tempDir, "globalState.json"), {
			mode: "act",
			actModeApiProvider: "openrouter",
			actModeOpenRouterModelId: "anthropic/claude-sonnet-4",
		})
		writeJson(path.join(tempDir, "secrets.json"), {
			openRouterApiKey: "sk-or-legacy",
		})

		const result = migrateProviders(tempDir)
		expect(result.migrated).toBe(true)
		expect(result.lastUsedProvider).toBe("openrouter")
	})

	it("migrates Bedrock provider with AWS credentials", () => {
		writeJson(path.join(tempDir, "globalState.json"), {
			mode: "act",
			actModeApiProvider: "bedrock",
			awsRegion: "us-east-1",
			awsUseCrossRegionInference: true,
		})
		writeJson(path.join(tempDir, "secrets.json"), {
			awsAccessKey: "AKIA-legacy",
			awsSecretKey: "secret-legacy",
		})

		const result = migrateProviders(tempDir)
		expect(result.migrated).toBe(true)
		expect(result.lastUsedProvider).toBe("bedrock")
	})

	it("migrates Ollama provider (local, no API key)", () => {
		writeJson(path.join(tempDir, "globalState.json"), {
			mode: "act",
			actModeApiProvider: "ollama",
			actModeOllamaModelId: "llama3",
			ollamaBaseUrl: "http://localhost:11434",
		})
		writeJson(path.join(tempDir, "secrets.json"), {})

		const result = migrateProviders(tempDir)
		expect(result.migrated).toBe(true)
		expect(result.lastUsedProvider).toBe("ollama")
	})

	it("does not overwrite existing provider entries", () => {
		// Pre-create a provider entry using the SDK's own method
		// (direct file writes may not match the SDK's schema exactly)
		const preManager = getProviderSettingsManager(tempDir)
		preManager.saveProviderSettings({
			provider: "anthropic",
			model: "claude-sonnet-4-6",
			apiKey: "already-migrated-key",
		})

		// Also write legacy state with a different key
		writeJson(path.join(tempDir, "globalState.json"), {
			mode: "act",
			actModeApiProvider: "anthropic",
		})
		writeJson(path.join(tempDir, "secrets.json"), {
			apiKey: "legacy-key-should-not-overwrite",
		})

		// Creating a new manager triggers auto-migration
		const manager = getProviderSettingsManager(tempDir)
		const settings = manager.getProviderSettings("anthropic")
		// The existing entry should NOT be overwritten
		expect(settings?.apiKey).toBe("already-migrated-key")
		expect(manager.read().providers.anthropic?.tokenSource).toBe("manual")
	})

	it("is idempotent — calling twice produces the same result", () => {
		writeJson(path.join(tempDir, "globalState.json"), {
			mode: "act",
			actModeApiProvider: "anthropic",
		})
		writeJson(path.join(tempDir, "secrets.json"), {
			apiKey: "sk-ant-test",
		})

		const result1 = migrateProviders(tempDir)
		const result2 = migrateProviders(tempDir)

		// Second call should not add more providers
		expect(result2.providerCount).toBe(result1.providerCount)
		expect(result2.lastUsedProvider).toBe(result1.lastUsedProvider)
	})

	it("migrates Cline provider with account auth", () => {
		writeJson(path.join(tempDir, "globalState.json"), {
			mode: "act",
			actModeApiProvider: "cline",
			actModeClineModelId: "anthropic/claude-sonnet-4",
		})
		writeJson(path.join(tempDir, "secrets.json"), {
			clineApiKey: "cline-legacy-token",
		})

		const result = migrateProviders(tempDir)
		expect(result.migrated).toBe(true)
		expect(result.lastUsedProvider).toBe("cline")
	})

	it("handles missing secrets.json gracefully", () => {
		writeJson(path.join(tempDir, "globalState.json"), {
			mode: "act",
			actModeApiProvider: "ollama",
			actModeOllamaModelId: "llama3",
		})
		// No secrets.json — Ollama doesn't need one

		const result = migrateProviders(tempDir)
		expect(result.migrated).toBe(true)
	})
})

// ---------------------------------------------------------------------------
// getProviderSettingsManager
// ---------------------------------------------------------------------------

describe("getProviderSettingsManager", () => {
	it("returns a ProviderSettingsManager instance", () => {
		const manager = getProviderSettingsManager(tempDir)
		expect(manager).toBeDefined()
		expect(typeof manager.read).toBe("function")
		expect(typeof manager.getProviderSettings).toBe("function")
	})

	it("reads empty state when no providers exist", () => {
		const manager = getProviderSettingsManager(tempDir)
		const state = manager.read()
		expect(Object.keys(state.providers)).toHaveLength(0)
	})
})
