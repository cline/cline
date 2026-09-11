import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type * as vscode from "vscode"
import { migrateWelcomeViewCompleted } from "../state-migrations"

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
