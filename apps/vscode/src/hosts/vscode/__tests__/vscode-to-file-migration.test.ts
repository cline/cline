import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import { ClineFileStorage } from "@shared/storage/ClineFileStorage"
import { createStorageContext, type StorageContext } from "@shared/storage/storage-context"
import fs from "fs"
import os from "os"
import path from "path"
import sinon from "sinon"
import { exportVSCodeStorageToSharedFiles } from "../vscode-to-file-migration"

/**
 * Create a minimal mock of VSCode's ExtensionContext for migration testing.
 * Provides in-memory implementations of globalState, secrets, and workspaceState.
 */
function createMockVSCodeContext() {
	const globalStateStore = new Map<string, any>()
	const secretsStore = new Map<string, string>()
	const workspaceStateStore = new Map<string, any>()

	return {
		globalState: {
			get<T>(key: string): T | undefined {
				return globalStateStore.get(key) as T | undefined
			},
			async update(key: string, value: any): Promise<void> {
				if (value === undefined) {
					globalStateStore.delete(key)
				} else {
					globalStateStore.set(key, value)
				}
			},
			keys(): readonly string[] {
				return Array.from(globalStateStore.keys())
			},
			setKeysForSync() {},
		},
		secrets: {
			async get(key: string): Promise<string | undefined> {
				return secretsStore.get(key)
			},
			async store(key: string, value: string): Promise<void> {
				secretsStore.set(key, value)
			},
			async delete(key: string): Promise<void> {
				secretsStore.delete(key)
			},
			onDidChange: () => ({ dispose: () => {} }),
		},
		workspaceState: {
			get<T>(key: string): T | undefined {
				return workspaceStateStore.get(key) as T | undefined
			},
			async update(key: string, value: any): Promise<void> {
				if (value === undefined) {
					workspaceStateStore.delete(key)
				} else {
					workspaceStateStore.set(key, value)
				}
			},
			keys(): readonly string[] {
				return Array.from(workspaceStateStore.keys())
			},
			setKeysForSync() {},
		},
		// Expose internal stores for test setup
		_globalStateStore: globalStateStore,
		_secretsStore: secretsStore,
		_workspaceStateStore: workspaceStateStore,
	}
}

describe("vscode-to-file-migration", () => {
	let sandbox: sinon.SinonSandbox
	let tempDir: string
	let storageContext: StorageContext

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		tempDir = path.join(os.tmpdir(), `migration-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		fs.mkdirSync(tempDir, { recursive: true })

		storageContext = createStorageContext({
			clineDir: tempDir,
			workspacePath: tempDir,
		})
	})

	afterEach(() => {
		sandbox.restore()
		try {
			fs.rmSync(tempDir, { recursive: true, force: true })
		} catch {
			// Ignore cleanup errors
		}
	})

	describe("sentinel behavior", () => {
		it("should migrate on first run (no sentinel)", async () => {
			const mockCtx = createMockVSCodeContext()
			mockCtx._globalStateStore.set("mode", "act")

			const result = await exportVSCodeStorageToSharedFiles(mockCtx as any, storageContext)

			result.migrated.should.be.true()
			result.globalStateCount.should.be.greaterThan(0)
			storageContext.globalState.get("mode")!.should.equal("act")
			// Both sentinels should be written
			storageContext.globalState.get("__vscodeMigrationVersion")!.should.equal(1)
			storageContext.workspaceState.get("__vscodeMigrationVersion")!.should.equal(1)
		})

		it("should skip everything when both sentinels are current version", async () => {
			// Pre-set BOTH sentinels
			storageContext.globalState.update("__vscodeMigrationVersion", 1)
			storageContext.workspaceState.set("__vscodeMigrationVersion", 1)

			const mockCtx = createMockVSCodeContext()
			mockCtx._globalStateStore.set("mode", "plan")
			mockCtx._workspaceStateStore.set("localClineRulesToggles", { "rule-1": true })

			const result = await exportVSCodeStorageToSharedFiles(mockCtx as any, storageContext)

			result.migrated.should.be.false()
			result.globalStateCount.should.equal(0)
			result.workspaceStateCount.should.equal(0)
			// Should NOT have the VSCode values — migration was skipped
			const modeVal = storageContext.globalState.get("mode")
			;(modeVal === undefined).should.be.true()
		})

		it("should skip everything when both sentinels are higher version", async () => {
			storageContext.globalState.update("__vscodeMigrationVersion", 999)
			storageContext.workspaceState.set("__vscodeMigrationVersion", 999)

			const mockCtx = createMockVSCodeContext()
			mockCtx._globalStateStore.set("mode", "act")

			const result = await exportVSCodeStorageToSharedFiles(mockCtx as any, storageContext)

			result.migrated.should.be.false()
		})

		it("should re-run migration if sentinels are lower version", async () => {
			storageContext.globalState.update("__vscodeMigrationVersion", 0)
			storageContext.workspaceState.set("__vscodeMigrationVersion", 0)

			const mockCtx = createMockVSCodeContext()
			mockCtx._globalStateStore.set("mode", "plan")

			const result = await exportVSCodeStorageToSharedFiles(mockCtx as any, storageContext)

			result.migrated.should.be.true()
		})

		it("should migrate workspace state when globals already migrated (new workspace)", async () => {
			// Simulate: globals+secrets already migrated, but this is a fresh workspace
			storageContext.globalState.update("__vscodeMigrationVersion", 1)
			// workspaceState has NO sentinel — this is a new workspace

			const mockCtx = createMockVSCodeContext()
			mockCtx._globalStateStore.set("mode", "plan") // should be skipped
			mockCtx._secretsStore.set("apiKey", "sk-test") // should be skipped
			mockCtx._workspaceStateStore.set("localClineRulesToggles", { "rule-1": true })

			const result = await exportVSCodeStorageToSharedFiles(mockCtx as any, storageContext)

			result.migrated.should.be.true()
			// Global state and secrets should NOT have been migrated
			result.globalStateCount.should.equal(0)
			result.secretsCount.should.equal(0)
			// Workspace state SHOULD have been migrated
			result.workspaceStateCount.should.equal(1)
			const stored = storageContext.workspaceState.get("localClineRulesToggles") as any
			stored.should.deepEqual({ "rule-1": true })
			// Workspace sentinel should now be set
			storageContext.workspaceState.get("__vscodeMigrationVersion")!.should.equal(1)
		})

		it("should migrate globals when workspace already migrated", async () => {
			// Edge case: workspace was somehow migrated but globals were not
			storageContext.workspaceState.set("__vscodeMigrationVersion", 1)
			// globalState has NO sentinel

			const mockCtx = createMockVSCodeContext()
			mockCtx._globalStateStore.set("mode", "plan")
			mockCtx._workspaceStateStore.set("localClineRulesToggles", { "rule-1": true }) // should be skipped

			const result = await exportVSCodeStorageToSharedFiles(mockCtx as any, storageContext)

			result.migrated.should.be.true()
			// Global state SHOULD have been migrated
			result.globalStateCount.should.be.greaterThan(0)
			storageContext.globalState.get("mode")!.should.equal("plan")
			// Workspace state should NOT have been migrated
			result.workspaceStateCount.should.equal(0)
			// Global sentinel should now be set
			storageContext.globalState.get("__vscodeMigrationVersion")!.should.equal(1)
		})
	})

	describe("global state migration", () => {
		it("should migrate global state keys", async () => {
			const mockCtx = createMockVSCodeContext()
			mockCtx._globalStateStore.set("mode", "plan")
			mockCtx._globalStateStore.set("yoloModeToggled", true)
			mockCtx._globalStateStore.set("enableCheckpointsSetting", false)

			const result = await exportVSCodeStorageToSharedFiles(mockCtx as any, storageContext)

			result.migrated.should.be.true()
			storageContext.globalState.get("mode")!.should.equal("plan")
			storageContext.globalState.get("yoloModeToggled")!.should.equal(true)
			storageContext.globalState.get("enableCheckpointsSetting")!.should.equal(false)
		})

		it("should NOT overwrite existing file store values", async () => {
			// Pre-populate the file store with a value
			storageContext.globalState.update("mode", "act")

			const mockCtx = createMockVSCodeContext()
			mockCtx._globalStateStore.set("mode", "plan") // VSCode has different value

			const result = await exportVSCodeStorageToSharedFiles(mockCtx as any, storageContext)

			result.migrated.should.be.true()
			result.skippedExisting.should.be.greaterThan(0)
			// File store value should be preserved, NOT overwritten
			storageContext.globalState.get("mode")!.should.equal("act")
		})

		it("should skip undefined values", async () => {
			const mockCtx = createMockVSCodeContext()
			// Don't set anything — all keys will be undefined

			const result = await exportVSCodeStorageToSharedFiles(mockCtx as any, storageContext)

			result.migrated.should.be.true()
			result.globalStateCount.should.equal(0)
		})

		it("should skip taskHistory (it has its own file)", async () => {
			const mockCtx = createMockVSCodeContext()
			mockCtx._globalStateStore.set("taskHistory", [{ id: "old", ts: 123 }])

			const result = await exportVSCodeStorageToSharedFiles(mockCtx as any, storageContext)

			result.migrated.should.be.true()
			// taskHistory should NOT be in the file store
			const val = storageContext.globalState.get("taskHistory")
			;(val === undefined).should.be.true()
		})
	})

	describe("secrets migration", () => {
		it("should migrate secret keys", async () => {
			const mockCtx = createMockVSCodeContext()
			mockCtx._secretsStore.set("apiKey", "sk-test-123")
			mockCtx._secretsStore.set("openRouterApiKey", "or-test-456")

			const result = await exportVSCodeStorageToSharedFiles(mockCtx as any, storageContext)

			result.migrated.should.be.true()
			result.secretsCount.should.equal(2)
			storageContext.secrets.get("apiKey")!.should.equal("sk-test-123")
			storageContext.secrets.get("openRouterApiKey")!.should.equal("or-test-456")
		})

		it("should NOT overwrite existing secrets in file store", async () => {
			storageContext.secrets.set("apiKey", "existing-key")

			const mockCtx = createMockVSCodeContext()
			mockCtx._secretsStore.set("apiKey", "vscode-key")

			const result = await exportVSCodeStorageToSharedFiles(mockCtx as any, storageContext)

			result.migrated.should.be.true()
			result.skippedExisting.should.be.greaterThan(0)
			storageContext.secrets.get("apiKey")!.should.equal("existing-key")
		})

		it("should skip empty string secrets", async () => {
			const mockCtx = createMockVSCodeContext()
			mockCtx._secretsStore.set("apiKey", "")

			const result = await exportVSCodeStorageToSharedFiles(mockCtx as any, storageContext)

			result.migrated.should.be.true()
			result.secretsCount.should.equal(0)
		})

		it("should continue even if a single secret read fails", async () => {
			const mockCtx = createMockVSCodeContext()
			mockCtx._secretsStore.set("openRouterApiKey", "or-key-123")

			// Make one secret read fail
			const origGet = mockCtx.secrets.get.bind(mockCtx.secrets)
			mockCtx.secrets.get = async (key: string) => {
				if (key === "apiKey") {
					throw new Error("Simulated secret read error")
				}
				return origGet(key)
			}

			const result = await exportVSCodeStorageToSharedFiles(mockCtx as any, storageContext)

			result.migrated.should.be.true()
			result.secretsCount.should.equal(1)
			storageContext.secrets.get("openRouterApiKey")!.should.equal("or-key-123")
		})
	})

	describe("workspace state migration", () => {
		it("should migrate workspace state keys", async () => {
			const toggles = { "rule-1": true, "rule-2": false }
			const mockCtx = createMockVSCodeContext()
			mockCtx._workspaceStateStore.set("localClineRulesToggles", toggles)

			const result = await exportVSCodeStorageToSharedFiles(mockCtx as any, storageContext)

			result.migrated.should.be.true()
			result.workspaceStateCount.should.equal(1)
			const stored = storageContext.workspaceState.get("localClineRulesToggles") as any
			stored.should.deepEqual(toggles)
		})

		it("should NOT overwrite existing workspace state", async () => {
			const existingToggles = { "rule-existing": true }
			storageContext.workspaceState.set("localClineRulesToggles", existingToggles)

			const mockCtx = createMockVSCodeContext()
			mockCtx._workspaceStateStore.set("localClineRulesToggles", { "rule-vscode": true })

			const result = await exportVSCodeStorageToSharedFiles(mockCtx as any, storageContext)

			result.migrated.should.be.true()
			const stored = storageContext.workspaceState.get("localClineRulesToggles") as any
			stored.should.deepEqual(existingToggles)
		})
	})

	describe("error handling", () => {
		it("should NOT write sentinel if migration throws", async () => {
			const mockCtx = createMockVSCodeContext()

			// Stub setBatch to throw an error
			sandbox.stub(storageContext.globalState, "setBatch").callsFake(() => {
				throw new Error("Simulated disk write error")
			})

			mockCtx._globalStateStore.set("mode", "act")
			mockCtx._globalStateStore.set("yoloModeToggled", true)
			mockCtx._globalStateStore.set("enableCheckpointsSetting", true)

			try {
				await exportVSCodeStorageToSharedFiles(mockCtx as any, storageContext)
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.message.should.equal("Simulated disk write error")
			}

			// Sentinel should NOT be written
			const sentinel = storageContext.globalState.get("__vscodeMigrationVersion")
			;(sentinel === undefined).should.be.true()
		})
	})

	describe("idempotency", () => {
		it("should produce same result when run twice", async () => {
			const mockCtx = createMockVSCodeContext()
			mockCtx._globalStateStore.set("mode", "plan")
			mockCtx._secretsStore.set("apiKey", "sk-test")

			// First run
			const result1 = await exportVSCodeStorageToSharedFiles(mockCtx as any, storageContext)
			result1.migrated.should.be.true()

			// Second run — should be skipped due to sentinel
			const result2 = await exportVSCodeStorageToSharedFiles(mockCtx as any, storageContext)
			result2.migrated.should.be.false()
			result2.globalStateCount.should.equal(0)

			// Values should still be correct
			storageContext.globalState.get("mode")!.should.equal("plan")
			storageContext.secrets.get("apiKey")!.should.equal("sk-test")
		})
	})
})

describe("createStorageContext", () => {
	let tempDir: string

	beforeEach(() => {
		tempDir = path.join(os.tmpdir(), `storage-ctx-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
	})

	afterEach(() => {
		try {
			fs.rmSync(tempDir, { recursive: true, force: true })
		} catch {
			// Ignore
		}
	})

	it("should create all three stores", () => {
		const ctx = createStorageContext({ clineDir: tempDir, workspacePath: "/fake/workspace" })

		ctx.globalState.should.be.instanceOf(ClineFileStorage)
		ctx.secrets.should.be.instanceOf(ClineFileStorage)
		ctx.workspaceState.should.be.instanceOf(ClineFileStorage)
	})

	it("should create directories", () => {
		const ctx = createStorageContext({ clineDir: tempDir, workspacePath: "/fake/workspace" })

		fs.existsSync(ctx.dataDir).should.be.true()
		fs.existsSync(ctx.workspaceStoragePath).should.be.true()
	})

	it("should produce deterministic workspace hashes", () => {
		const ctx1 = createStorageContext({ clineDir: tempDir, workspacePath: "/some/project" })
		const ctx2 = createStorageContext({ clineDir: tempDir, workspacePath: "/some/project" })

		ctx1.workspaceStoragePath.should.equal(ctx2.workspaceStoragePath)
	})

	it("should produce different hashes for different workspaces", () => {
		const ctx1 = createStorageContext({ clineDir: tempDir, workspacePath: "/project-a" })
		const ctx2 = createStorageContext({ clineDir: tempDir, workspacePath: "/project-b" })

		ctx1.workspaceStoragePath.should.not.equal(ctx2.workspaceStoragePath)
	})

	it("should use explicit workspaceStorageDir when provided", () => {
		const explicitDir = path.join(tempDir, "explicit-ws")
		const ctx = createStorageContext({
			clineDir: tempDir,
			workspacePath: "/ignored",
			workspaceStorageDir: explicitDir,
		})

		ctx.workspaceStoragePath.should.equal(explicitDir)
	})

	it("should store and retrieve values correctly", () => {
		const ctx = createStorageContext({ clineDir: tempDir, workspacePath: "/test" })

		ctx.globalState.update("testKey", "testValue")
		ctx.globalState.get("testKey")!.should.equal("testValue")

		ctx.secrets.set("secretKey", "secretValue")
		ctx.secrets.get("secretKey")!.should.equal("secretValue")

		ctx.workspaceState.set("wsKey", { toggle: true })
		const ws = ctx.workspaceState.get("wsKey") as any
		ws.toggle.should.equal(true)
	})
})
