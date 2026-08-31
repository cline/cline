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
