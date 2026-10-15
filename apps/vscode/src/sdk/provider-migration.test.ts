import fs from "node:fs"
import os from "node:os"
import path from "node:path"
// The SDK's ProviderSettingsManager is stubbed under vitest (see
// vitest.config.ts → cline-core-vitest-stub.ts), so these tests cover the
// adapter's responsibilities only: that `migrateProviders` faithfully maps the
// manager's state into a ProviderMigrationResult, and that
// `getProviderSettingsManager` caches per dataDir. The actual legacy
// (globalState.json/secrets.json) → providers.json migration logic lives in the
// SDK (`migrateLegacyProviderSettings`) and is covered by the SDK's own tests.
//
// Each test gets a fresh tempDir, so the per-dataDir manager cache and the
// stub's per-dataDir store are naturally isolated between tests.
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { StateManager } from "@/core/storage/StateManager"
import { getProviderSettingsManager, migrateOpenAiCompatibleBaseUrlToV1, migrateProviders } from "./provider-migration"

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

// ---------------------------------------------------------------------------
// migrateProviders — adapter wrapper over ProviderSettingsManager
// ---------------------------------------------------------------------------

describe("migrateProviders", () => {
	it("reports no migration when the store is empty", () => {
		const result = migrateProviders(tempDir)
		expect(result.migrated).toBe(false)
		expect(result.providerCount).toBe(0)
		expect(result.lastUsedProvider).toBeUndefined()
	})

	it("reports migrated=true when a provider was tagged tokenSource=migration", () => {
		// migrateProviders reads through the same dataDir-keyed store the SDK
		// manager would have written during auto-migration. Seed a migrated
		// entry to model that outcome.
		getProviderSettingsManager(tempDir).saveProviderSettings({
			provider: "anthropic",
			model: "claude-sonnet-4-6",
			apiKey: "sk-ant-legacy-key",
			tokenSource: "migration",
		})

		const result = migrateProviders(tempDir)
		expect(result.migrated).toBe(true)
		expect(result.providerCount).toBe(1)
		expect(result.lastUsedProvider).toBe("anthropic")
	})

	it("reports migrated=false when providers exist but none came from migration", () => {
		getProviderSettingsManager(tempDir).saveProviderSettings({
			provider: "anthropic",
			model: "claude-sonnet-4-6",
			apiKey: "manual-key",
			tokenSource: "manual",
		})

		const result = migrateProviders(tempDir)
		expect(result.migrated).toBe(false)
		expect(result.providerCount).toBe(1)
		expect(result.lastUsedProvider).toBe("anthropic")
	})

	it("counts every provider in the store", () => {
		const manager = getProviderSettingsManager(tempDir)
		manager.saveProviderSettings({ provider: "anthropic", tokenSource: "migration" })
		manager.saveProviderSettings({ provider: "openrouter", tokenSource: "migration" })
		manager.saveProviderSettings({ provider: "ollama", tokenSource: "manual" })

		const result = migrateProviders(tempDir)
		expect(result.providerCount).toBe(3)
		expect(result.migrated).toBe(true)
	})

	it("is idempotent — calling twice produces the same result", () => {
		getProviderSettingsManager(tempDir).saveProviderSettings({
			provider: "anthropic",
			tokenSource: "migration",
		})

		const result1 = migrateProviders(tempDir)
		const result2 = migrateProviders(tempDir)

		expect(result2.providerCount).toBe(result1.providerCount)
		expect(result2.lastUsedProvider).toBe(result1.lastUsedProvider)
		expect(result2.migrated).toBe(result1.migrated)
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

	it("returns a cached instance for the same dataDir", () => {
		const first = getProviderSettingsManager(tempDir)
		const second = getProviderSettingsManager(tempDir)
		expect(second).toBe(first)
	})
})

// ---------------------------------------------------------------------------
// migrateOpenAiCompatibleBaseUrlToV1
// ---------------------------------------------------------------------------

describe("migrateOpenAiCompatibleBaseUrlToV1", () => {
	function fakeStateManager(initial: Record<string, unknown> = {}) {
		const state: Record<string, unknown> = { ...initial }
		const get = (key: string) => state[key]
		const stateManager = {
			getGlobalStateKey: get,
			getGlobalSettingsKey: get,
			setGlobalState: (key: string, value: unknown) => {
				state[key] = value
			},
		} as unknown as StateManager
		return { state, stateManager }
	}

	it.each([
		["https://example.com", "https://example.com/v1"],
		["http://localhost:8000/", "http://localhost:8000/v1"],
		[" http://127.0.0.1:1234 ", "http://127.0.0.1:1234/v1"],
	])("rewrites the host-only state URL %j to %j", (baseUrl, expected) => {
		const { state, stateManager } = fakeStateManager({ openAiBaseUrl: baseUrl })

		migrateOpenAiCompatibleBaseUrlToV1(stateManager, tempDir)

		expect(state.openAiBaseUrl).toBe(expected)
		expect(state.openAiBaseUrlV1Migrated).toBe(true)
	})

	it.each([
		"https://example.com/v1",
		"https://example.com/api/foo",
		"not a url",
	])("leaves the state URL %j unchanged", (baseUrl) => {
		const { state, stateManager } = fakeStateManager({ openAiBaseUrl: baseUrl })

		migrateOpenAiCompatibleBaseUrlToV1(stateManager, tempDir)

		expect(state.openAiBaseUrl).toBe(baseUrl)
		expect(state.openAiBaseUrlV1Migrated).toBe(true)
	})

	it("runs only once, so a host-only URL saved afterwards is kept", () => {
		const { state, stateManager } = fakeStateManager({ openAiBaseUrlV1Migrated: true, openAiBaseUrl: "https://example.com" })

		migrateOpenAiCompatibleBaseUrlToV1(stateManager, tempDir)

		expect(state.openAiBaseUrl).toBe("https://example.com")
	})

	it("leaves providers.json alone when the state URL is set", () => {
		const manager = getProviderSettingsManager(tempDir)
		manager.saveProviderSettings({ provider: "openai-compatible", baseUrl: "https://example.com" })
		const { stateManager } = fakeStateManager({ openAiBaseUrl: "https://example.com" })

		migrateOpenAiCompatibleBaseUrlToV1(stateManager, tempDir)

		expect(manager.getProviderSettings("openai-compatible")?.baseUrl).toBe("https://example.com")
	})

	it("rewrites the providers.json URL when the state URL is unset", () => {
		const manager = getProviderSettingsManager(tempDir)
		manager.saveProviderSettings({ provider: "openai-compatible", baseUrl: "https://example.com", apiKey: "key" })
		const { state, stateManager } = fakeStateManager()

		migrateOpenAiCompatibleBaseUrlToV1(stateManager, tempDir)

		expect(manager.getProviderSettings("openai-compatible")).toMatchObject({
			baseUrl: "https://example.com/v1",
			apiKey: "key",
		})
		expect(state.openAiBaseUrl).toBeUndefined()
		expect(state.openAiBaseUrlV1Migrated).toBe(true)
	})
})
