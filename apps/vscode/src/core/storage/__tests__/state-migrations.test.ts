import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type * as vscode from "vscode"
import { migrateLegacyNativeToolCallSetting, migrateWelcomeViewCompleted } from "../state-migrations"

/** Minimal ExtensionContext exposing the stores the migration touches. */
function makeContext(initial: { globalState?: Record<string, unknown>; secrets?: Record<string, string> } = {}) {
	const globalState = new Map<string, unknown>(Object.entries(initial.globalState ?? {}))
	const secrets = new Map<string, string>(Object.entries(initial.secrets ?? {}))
	const context = {
		globalState: {
			get: (key: string) => globalState.get(key),
			update: async (key: string, value: unknown) => {
				globalState.set(key, value)
			},
		},
		secrets: {
			get: async (key: string) => secrets.get(key),
		},
	} as unknown as vscode.ExtensionContext
	return { context, globalState }
}

let dataDir: string

/** Seed a file in the temp Cline data dir (e.g. globalState.json, secrets.json). */
function writeDataFile(name: string, contents: unknown) {
	fs.writeFileSync(path.join(dataDir, name), JSON.stringify(contents), "utf-8")
}

beforeEach(() => {
	dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cline-state-migrations-"))
})

afterEach(() => {
	fs.rmSync(dataDir, { recursive: true, force: true })
})

describe("migrateWelcomeViewCompleted", () => {
	it("leaves an already-set flag untouched", async () => {
		const { context, globalState } = makeContext({ globalState: { welcomeViewCompleted: true } })
		await migrateWelcomeViewCompleted(context, dataDir)
		expect(globalState.get("welcomeViewCompleted")).toBe(true)
	})

	it("sets false when no configuration exists anywhere (fresh install)", async () => {
		const { context, globalState } = makeContext()
		await migrateWelcomeViewCompleted(context, dataDir)
		expect(globalState.get("welcomeViewCompleted")).toBe(false)
	})

	it("detects an API key in VS Code SecretStorage (pre-4.x upgrade path, unchanged)", async () => {
		const { context, globalState } = makeContext({ secrets: { apiKey: "sk-ant-123" } })
		await migrateWelcomeViewCompleted(context, dataDir)
		expect(globalState.get("welcomeViewCompleted")).toBe(true)
	})

	it("detects an API key in the file-backed secrets.json (ENG-2346 regression)", async () => {
		const { context, globalState } = makeContext()
		writeDataFile("secrets.json", { openRouterApiKey: "sk-or-123" })
		await migrateWelcomeViewCompleted(context, dataDir)
		expect(globalState.get("welcomeViewCompleted")).toBe(true)
	})

	it("detects keyless provider config in the file-backed globalState.json", async () => {
		const { context, globalState } = makeContext()
		writeDataFile("globalState.json", { awsRegion: "us-east-1" })
		await migrateWelcomeViewCompleted(context, dataDir)
		expect(globalState.get("welcomeViewCompleted")).toBe(true)
	})

	it("honors welcomeViewCompleted=true already in the file-backed globalState.json", async () => {
		const { context, globalState } = makeContext()
		writeDataFile("globalState.json", { welcomeViewCompleted: true })
		await migrateWelcomeViewCompleted(context, dataDir)
		expect(globalState.get("welcomeViewCompleted")).toBe(true)
	})

	it("ignores non-provider secrets (authNonce, mcpOAuthSecrets)", async () => {
		const { context, globalState } = makeContext()
		writeDataFile("secrets.json", { authNonce: "nonce", mcpOAuthSecrets: "{}" })
		await migrateWelcomeViewCompleted(context, dataDir)
		expect(globalState.get("welcomeViewCompleted")).toBe(false)
	})
})

describe("migrateLegacyNativeToolCallSetting", () => {
	function makeStateManager() {
		const writes: Array<[string, boolean]> = []
		return {
			writes,
			stateManager: {
				setGlobalState: (key: "enableXmlToolCalling", value: boolean) => {
					writes.push([key, value])
				},
			},
		}
	}

	it("enables XML tool calling when legacy native tool calling was explicitly disabled", () => {
		const { stateManager, writes } = makeStateManager()
		writeDataFile("globalState.json", { nativeToolCallEnabled: false })
		migrateLegacyNativeToolCallSetting(stateManager, dataDir)
		expect(writes).toEqual([["enableXmlToolCalling", true]])
	})

	it("enables XML tool calling for non-Cline providers like ollama", () => {
		const { stateManager, writes } = makeStateManager()
		writeDataFile("globalState.json", {
			nativeToolCallEnabled: false,
			planModeApiProvider: "ollama",
			actModeApiProvider: "ollama",
		})
		migrateLegacyNativeToolCallSetting(stateManager, dataDir)
		expect(writes).toEqual([["enableXmlToolCalling", true]])
	})

	it("does nothing when the user is on the cline provider", () => {
		const { stateManager, writes } = makeStateManager()
		writeDataFile("globalState.json", {
			nativeToolCallEnabled: false,
			planModeApiProvider: "cline",
			actModeApiProvider: "cline",
		})
		migrateLegacyNativeToolCallSetting(stateManager, dataDir)
		expect(writes).toEqual([])
	})

	it("does nothing when the user is on the cline-pass provider", () => {
		const { stateManager, writes } = makeStateManager()
		writeDataFile("globalState.json", {
			nativeToolCallEnabled: false,
			planModeApiProvider: "cline-pass",
			actModeApiProvider: "cline-pass",
		})
		migrateLegacyNativeToolCallSetting(stateManager, dataDir)
		expect(writes).toEqual([])
	})

	it("does nothing when either mode uses a Cline provider (the setting is global)", () => {
		const { stateManager, writes } = makeStateManager()
		writeDataFile("globalState.json", {
			nativeToolCallEnabled: false,
			planModeApiProvider: "cline",
			actModeApiProvider: "ollama",
		})
		migrateLegacyNativeToolCallSetting(stateManager, dataDir)
		expect(writes).toEqual([])
	})

	it("does nothing when the legacy setting is absent (user never touched it)", () => {
		const { stateManager, writes } = makeStateManager()
		writeDataFile("globalState.json", { someOtherKey: 1 })
		migrateLegacyNativeToolCallSetting(stateManager, dataDir)
		expect(writes).toEqual([])
	})

	it("does nothing when the legacy setting was explicitly enabled", () => {
		const { stateManager, writes } = makeStateManager()
		writeDataFile("globalState.json", { nativeToolCallEnabled: true })
		migrateLegacyNativeToolCallSetting(stateManager, dataDir)
		expect(writes).toEqual([])
	})

	it("never re-runs once the new setting exists on disk, even as false", () => {
		const { stateManager, writes } = makeStateManager()
		writeDataFile("globalState.json", {
			nativeToolCallEnabled: false,
			enableXmlToolCalling: false,
		})
		migrateLegacyNativeToolCallSetting(stateManager, dataDir)
		expect(writes).toEqual([])
	})

	it("does nothing on a fresh install with no state file", () => {
		const { stateManager, writes } = makeStateManager()
		migrateLegacyNativeToolCallSetting(stateManager, dataDir)
		expect(writes).toEqual([])
	})
})
