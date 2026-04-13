import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { ProviderSettingsManager } from "@clinebot/core"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { clearMigrationSentinel, runProviderMigration } from "../provider-migration"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTempDataDir(): string {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cline-migration-test-"))
	const dataDir = path.join(tmp, "data")
	fs.mkdirSync(dataDir, { recursive: true })
	return dataDir
}

function writeJson(filePath: string, data: unknown): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true })
	fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8")
}

function readJson(filePath: string): unknown {
	return JSON.parse(fs.readFileSync(filePath, "utf-8"))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Provider Migration", () => {
	let dataDir: string

	beforeEach(() => {
		dataDir = createTempDataDir()
	})

	afterEach(() => {
		fs.rmSync(path.dirname(dataDir), { recursive: true, force: true })
	})

	describe("runProviderMigration", () => {
		it("migrates Anthropic key from pre-SDK provider state to providers.json", () => {
			writeJson(path.join(dataDir, "globalState.json"), {
				mode: "act",
				actModeApiProvider: "anthropic",
				actModeApiModelId: "claude-sonnet-4-20250514",
			})
			writeJson(path.join(dataDir, "secrets.json"), {
				apiKey: "sk-ant-test-key-12345",
			})

			const result = runProviderMigration({ dataDir })

			expect(result.ran).toBe(true)
			expect(result.manager).toBeDefined()
			expect(result.providerCount).toBeGreaterThan(0)

			// Verify the manager can read back the migrated key
			const settings = result.manager.getProviderSettings("anthropic")
			expect(settings).toBeDefined()
			expect(settings?.apiKey).toBe("sk-ant-test-key-12345")
		})

		it("migrates OpenRouter key", () => {
			writeJson(path.join(dataDir, "globalState.json"), {
				mode: "act",
				actModeApiProvider: "openrouter",
				actModeOpenRouterModelId: "google/gemini-2.5-pro",
			})
			writeJson(path.join(dataDir, "secrets.json"), {
				openRouterApiKey: "sk-or-test-key-67890",
			})

			const result = runProviderMigration({ dataDir })

			expect(result.ran).toBe(true)

			const settings = result.manager.getProviderSettings("openrouter")
			expect(settings).toBeDefined()
			expect(settings?.apiKey).toBe("sk-or-test-key-67890")
		})

		it("sentinel prevents re-migration on second call", () => {
			writeJson(path.join(dataDir, "globalState.json"), {
				mode: "act",
				actModeApiProvider: "anthropic",
			})
			writeJson(path.join(dataDir, "secrets.json"), {
				apiKey: "sk-ant-first-run",
			})

			// First run — should migrate
			const result1 = runProviderMigration({ dataDir })
			expect(result1.ran).toBe(true)

			// Second run — should skip due to sentinel
			const result2 = runProviderMigration({ dataDir })
			expect(result2.ran).toBe(false)
			expect(result2.skipReason).toBe("sentinel")
			// Manager still returned and functional
			expect(result2.manager).toBeDefined()
		})

		it("clearMigrationSentinel allows re-migration", () => {
			writeJson(path.join(dataDir, "globalState.json"), {
				mode: "act",
				actModeApiProvider: "anthropic",
			})
			writeJson(path.join(dataDir, "secrets.json"), {
				apiKey: "sk-ant-first-run",
			})

			// First run
			const result1 = runProviderMigration({ dataDir })
			expect(result1.ran).toBe(true)

			// Clear sentinel
			clearMigrationSentinel(dataDir)

			// Should run again (though SDK's migration is idempotent)
			const result2 = runProviderMigration({ dataDir })
			// ran = true because providers exist after re-construction
			expect(result2.skipReason).toBeUndefined()
			expect(result2.manager).toBeDefined()
		})

		it("does not overwrite existing providers.json entries", () => {
			// Pre-populate providers.json using the SDK manager (ensures valid schema)
			const providersPath = path.join(dataDir, "settings", "providers.json")
			fs.mkdirSync(path.dirname(providersPath), { recursive: true })
			const preManager = new ProviderSettingsManager({ filePath: providersPath })
			preManager.saveProviderSettings({
				provider: "openai",
				model: "gpt-5",
				apiKey: "already-configured-key",
			})

			// Pre-SDK provider data for anthropic
			writeJson(path.join(dataDir, "globalState.json"), {
				mode: "act",
				actModeApiProvider: "anthropic",
			})
			writeJson(path.join(dataDir, "secrets.json"), {
				apiKey: "sk-ant-new-key",
			})

			const result = runProviderMigration({ dataDir })

			// Verify existing OpenAI entry was preserved
			const openaiSettings = result.manager.getProviderSettings("openai")
			expect(openaiSettings?.apiKey).toBe("already-configured-key")

			// Verify Anthropic was added
			const anthropicSettings = result.manager.getProviderSettings("anthropic")
			expect(anthropicSettings).toBeDefined()
			expect(anthropicSettings?.apiKey).toBe("sk-ant-new-key")
		})

		it("returns no-pre-sdk-provider-data when no state files exist", () => {
			const result = runProviderMigration({ dataDir })

			expect(result.ran).toBe(false)
			expect(result.skipReason).toBe("no-pre-sdk-provider-data")
			expect(result.manager).toBeDefined()
		})

		it("handles missing secrets.json gracefully (globalState only)", () => {
			writeJson(path.join(dataDir, "globalState.json"), {
				mode: "act",
				actModeApiProvider: "anthropic",
			})
			// No secrets.json

			const result = runProviderMigration({ dataDir })

			// Should not error
			expect(result.skipReason).not.toBe("error")
			expect(result.manager).toBeDefined()
		})

		it("handles corrupt globalState.json gracefully", () => {
			fs.writeFileSync(path.join(dataDir, "globalState.json"), "NOT JSON {{{", "utf-8")
			writeJson(path.join(dataDir, "secrets.json"), {
				apiKey: "sk-ant-key",
			})

			// Should not throw
			const result = runProviderMigration({ dataDir })
			expect(result.manager).toBeDefined()
			// Migration may or may not have run but should not crash
		})

		it("writes sentinel with version and metadata", () => {
			writeJson(path.join(dataDir, "globalState.json"), {
				mode: "act",
				actModeApiProvider: "anthropic",
			})
			writeJson(path.join(dataDir, "secrets.json"), {
				apiKey: "sk-ant-key",
			})

			runProviderMigration({ dataDir })

			const sentinelPath = path.join(dataDir, "provider-migration-sentinel.json")
			expect(fs.existsSync(sentinelPath)).toBe(true)

			const sentinel = readJson(sentinelPath) as any
			expect(sentinel.version).toBe(1)
			expect(sentinel.migratedAt).toBeDefined()
			expect(typeof sentinel.migratedAt).toBe("string")
		})

		it("accepts custom providersFilePath", () => {
			const customPath = path.join(dataDir, "custom", "my-providers.json")

			writeJson(path.join(dataDir, "globalState.json"), {
				mode: "act",
				actModeApiProvider: "anthropic",
			})
			writeJson(path.join(dataDir, "secrets.json"), {
				apiKey: "sk-ant-custom-path",
			})

			const result = runProviderMigration({
				dataDir,
				providersFilePath: customPath,
			})

			expect(result.manager).toBeDefined()
			expect(fs.existsSync(customPath)).toBe(true)

			const settings = result.manager.getProviderSettings("anthropic")
			expect(settings?.apiKey).toBe("sk-ant-custom-path")
		})

		it("always returns a functional ProviderSettingsManager", () => {
			// Even with no data at all
			const result = runProviderMigration({ dataDir })
			expect(result.manager).toBeDefined()
			expect(typeof result.manager.read).toBe("function")
			expect(typeof result.manager.getProviderSettings).toBe("function")
		})
	})
})
