import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { GlobalStateAndSettings } from "@shared/storage/state-keys"
import { createStorageContext, type StorageContext } from "@shared/storage/storage-context"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getProviderSettingsManager } from "./provider-migration"
import { adoptSdkProviderSelection, syncLastUsedProvider } from "./provider-state-reconciliation"

// The SDK's ProviderSettingsManager is stubbed under vitest (see
// vitest.config.ts → cline-core-vitest-stub.ts) with a store keyed by data
// directory, so a fresh tempDir per test isolates both stores.

let tempDir: string
let storage: StorageContext
let setGlobalStateBatch: ReturnType<typeof vi.fn>

function stateWriter() {
	return { setGlobalStateBatch: setGlobalStateBatch as (updates: Partial<GlobalStateAndSettings>) => void }
}

function lastAdoptedUpdates(): Record<string, unknown> {
	return setGlobalStateBatch.mock.calls.at(-1)?.[0] as Record<string, unknown>
}

beforeEach(() => {
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cline-provider-reconciliation-"))
	storage = createStorageContext({ clineDir: tempDir, workspacePath: tempDir })
	setGlobalStateBatch = vi.fn()
})

afterEach(() => {
	fs.rmSync(tempDir, { recursive: true, force: true })
})

describe("adoptSdkProviderSelection", () => {
	it("adopts the SDK's last used provider and model when globalState has no selection", () => {
		getProviderSettingsManager(storage.dataDir).saveProviderSettings({
			provider: "openai-compatible",
			model: "fault/ok",
			apiKey: "qa-test-key",
			baseUrl: "http://127.0.0.1:8788/v1",
		})

		const adopted = adoptSdkProviderSelection(storage, stateWriter())

		expect(adopted).toBe("openai")
		expect(lastAdoptedUpdates()).toEqual({
			planModeApiProvider: "openai",
			actModeApiProvider: "openai",
			planModeOpenAiModelId: "fault/ok",
			actModeOpenAiModelId: "fault/ok",
		})
	})

	it("leaves an explicitly persisted selection alone", () => {
		storage.globalState.update("actModeApiProvider", "anthropic")
		getProviderSettingsManager(storage.dataDir).saveProviderSettings({
			provider: "openrouter",
			model: "anthropic/claude-sonnet-4.5",
			apiKey: "sk-or-v1-test",
		})

		expect(adoptSdkProviderSelection(storage, stateWriter())).toBeUndefined()
		expect(setGlobalStateBatch).not.toHaveBeenCalled()
	})

	it("adopts nothing when providers.json has no last used provider", () => {
		expect(adoptSdkProviderSelection(storage, stateWriter())).toBeUndefined()
		expect(setGlobalStateBatch).not.toHaveBeenCalled()
	})

	it("adopts nothing when the last used provider has no stored settings", () => {
		const manager = getProviderSettingsManager(storage.dataDir)
		manager.write({ ...manager.read(), lastUsedProvider: "openrouter" })

		expect(adoptSdkProviderSelection(storage, stateWriter())).toBeUndefined()
		expect(setGlobalStateBatch).not.toHaveBeenCalled()
	})

	it("adopts the provider without a model id when providers.json stores no model", () => {
		getProviderSettingsManager(storage.dataDir).saveProviderSettings({
			provider: "ollama",
			baseUrl: "http://127.0.0.1:11434",
		})

		expect(adoptSdkProviderSelection(storage, stateWriter())).toBe("ollama")
		expect(lastAdoptedUpdates()).toEqual({
			planModeApiProvider: "ollama",
			actModeApiProvider: "ollama",
		})
	})
})

describe("syncLastUsedProvider", () => {
	it("moves lastUsedProvider onto the provider selected in the extension", () => {
		const manager = getProviderSettingsManager(storage.dataDir)
		manager.saveProviderSettings({ provider: "openrouter", apiKey: "sk-or-v1-test" })
		manager.saveProviderSettings({ provider: "ollama", baseUrl: "http://127.0.0.1:11434" }, { setLastUsed: false })
		expect(manager.read().lastUsedProvider).toBe("openrouter")

		syncLastUsedProvider("ollama", storage.dataDir)

		expect(manager.read().lastUsedProvider).toBe("ollama")
	})

	it("translates the extension's provider spelling to the SDK's", () => {
		const manager = getProviderSettingsManager(storage.dataDir)
		manager.saveProviderSettings({ provider: "anthropic", apiKey: "sk-ant-test" })
		manager.saveProviderSettings({ provider: "openai-compatible", apiKey: "qa-test-key" }, { setLastUsed: false })

		syncLastUsedProvider("openai", storage.dataDir)

		expect(manager.read().lastUsedProvider).toBe("openai-compatible")
	})

	it("leaves the pointer alone when the selected provider has nothing stored", () => {
		const manager = getProviderSettingsManager(storage.dataDir)
		manager.saveProviderSettings({ provider: "openrouter", apiKey: "sk-or-v1-test" })

		syncLastUsedProvider("deepseek", storage.dataDir)

		expect(manager.read().lastUsedProvider).toBe("openrouter")
	})

	it("ignores an empty selection", () => {
		const manager = getProviderSettingsManager(storage.dataDir)
		manager.saveProviderSettings({ provider: "openrouter", apiKey: "sk-or-v1-test" })

		syncLastUsedProvider(undefined, storage.dataDir)
		syncLastUsedProvider("  ", storage.dataDir)

		expect(manager.read().lastUsedProvider).toBe("openrouter")
	})
})
