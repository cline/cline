import { afterAll, afterEach, beforeAll, beforeEach, describe, it, mock } from "bun:test"
import "should"
import * as actualFsUtils from "@utils/fs"
import fs from "fs/promises"
import os from "os"
import path from "path"
import sinon from "sinon"
import { HostProvider } from "@/hosts/host-provider"
import { setVscodeHostProviderMock } from "@/test/host-provider-test-utils"

// bun loads real ESM, so sinon cannot stub the `@utils/fs` namespace export
// ("ES Modules cannot be stubbed"). Inject a module-level sinon stub for
// `isDirectory` via mock.module so the full sinon stub API keeps working. It
// defaults to the real implementation; only the error-propagation test overrides
// it. Register both the alias form and the SUT's relative form.
const realIsDirectory = actualFsUtils.isDirectory
const isDirectoryStub: sinon.SinonStub = sinon.stub()
const fsUtilsMock = () => ({ ...actualFsUtils, isDirectory: isDirectoryStub })
mock.module("@utils/fs", fsUtilsMock)
mock.module("@/utils/fs", fsUtilsMock)

import {
	ensureSettingsDirectoryExists,
	getAllHooksDirs,
	getMcpSettingsFilePath,
	getWorkspaceHooksDirs,
	setRuntimeHooksDir,
} from "../disk"
import { StateManager } from "../StateManager"

describe("disk - hooks functionality", () => {
	let sandbox: sinon.SinonSandbox
	let tempDir: string

	beforeEach(async () => {
		sandbox = sinon.createSandbox()
		// Default the module-level isDirectory stub to the real implementation;
		// individual tests override it as needed.
		isDirectoryStub.reset()
		isDirectoryStub.callsFake((...args: unknown[]) => (realIsDirectory as (...a: unknown[]) => Promise<boolean>)(...args))
		tempDir = path.join(os.tmpdir(), `disk-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		await fs.mkdir(tempDir, { recursive: true })
	})

	afterEach(async () => {
		sandbox.restore()
		setRuntimeHooksDir(undefined)
		try {
			await fs.rm(tempDir, { recursive: true, force: true })
		} catch (_error) {
			// Ignore cleanup errors
		}
	})

	describe("getWorkspaceHooksDirs", () => {
		it("should return empty array when no workspace roots exist", async () => {
			sandbox.stub(StateManager, "get").returns({
				getGlobalStateKey: () => undefined,
			} as any)

			const result = await getWorkspaceHooksDirs()
			result.should.be.an.Array()
			result.length.should.equal(0)
		})

		it("should return empty array when workspace roots is empty array", async () => {
			sandbox.stub(StateManager, "get").returns({
				getGlobalStateKey: () => [],
			} as any)

			const result = await getWorkspaceHooksDirs()
			result.should.be.an.Array()
			result.length.should.equal(0)
		})

		it("should return empty array when no hooks directories exist", async () => {
			// Create workspace root without hooks directory
			const workspaceRoot = path.join(tempDir, "workspace1")
			await fs.mkdir(workspaceRoot, { recursive: true })

			sandbox.stub(StateManager, "get").returns({
				getGlobalStateKey: () => [{ path: workspaceRoot }],
			} as any)

			const result = await getWorkspaceHooksDirs()
			result.should.be.an.Array()
			result.length.should.equal(0)
		})

		it("should return hooks directory when it exists", async () => {
			// Create workspace root with hooks directory
			const workspaceRoot = path.join(tempDir, "workspace1")
			const hooksDir = path.join(workspaceRoot, ".clinerules", "hooks")
			await fs.mkdir(hooksDir, { recursive: true })

			sandbox.stub(StateManager, "get").returns({
				getGlobalStateKey: () => [{ path: workspaceRoot }],
			} as any)

			const result = await getWorkspaceHooksDirs()
			result.should.be.an.Array()
			result.length.should.equal(1)
			result[0].should.equal(hooksDir)
		})

		it("should not return hooks directory if it's a file instead of directory", async () => {
			// Create workspace root with hooks as a file (not directory)
			const workspaceRoot = path.join(tempDir, "workspace1")
			const hooksPath = path.join(workspaceRoot, ".clinerules", "hooks")
			await fs.mkdir(path.dirname(hooksPath), { recursive: true })
			await fs.writeFile(hooksPath, "not a directory")

			sandbox.stub(StateManager, "get").returns({
				getGlobalStateKey: () => [{ path: workspaceRoot }],
			} as any)

			const result = await getWorkspaceHooksDirs()
			result.should.be.an.Array()
			result.length.should.equal(0)
		})

		it("should return multiple hooks directories for multi-root workspace", async () => {
			// Create multiple workspace roots with hooks directories
			const workspaceRoot1 = path.join(tempDir, "workspace1")
			const workspaceRoot2 = path.join(tempDir, "workspace2")
			const hooksDir1 = path.join(workspaceRoot1, ".clinerules", "hooks")
			const hooksDir2 = path.join(workspaceRoot2, ".clinerules", "hooks")

			await fs.mkdir(hooksDir1, { recursive: true })
			await fs.mkdir(hooksDir2, { recursive: true })

			sandbox.stub(StateManager, "get").returns({
				getGlobalStateKey: () => [{ path: workspaceRoot1 }, { path: workspaceRoot2 }],
			} as any)

			const result = await getWorkspaceHooksDirs()
			result.should.be.an.Array()
			result.length.should.equal(2)
			result.should.containEql(hooksDir1)
			result.should.containEql(hooksDir2)
		})

		it("should return only existing hooks directories in multi-root workspace", async () => {
			// Create multiple workspace roots, but only some have hooks directories
			const workspaceRoot1 = path.join(tempDir, "workspace1")
			const workspaceRoot2 = path.join(tempDir, "workspace2")
			const workspaceRoot3 = path.join(tempDir, "workspace3")
			const hooksDir1 = path.join(workspaceRoot1, ".clinerules", "hooks")
			const hooksDir3 = path.join(workspaceRoot3, ".clinerules", "hooks")

			await fs.mkdir(hooksDir1, { recursive: true })
			await fs.mkdir(workspaceRoot2, { recursive: true }) // No hooks dir
			await fs.mkdir(hooksDir3, { recursive: true })

			sandbox.stub(StateManager, "get").returns({
				getGlobalStateKey: () => [{ path: workspaceRoot1 }, { path: workspaceRoot2 }, { path: workspaceRoot3 }],
			} as any)

			const result = await getWorkspaceHooksDirs()
			result.should.be.an.Array()
			result.length.should.equal(2)
			result.should.containEql(hooksDir1)
			result.should.containEql(hooksDir3)
			result.should.not.containEql(path.join(workspaceRoot2, ".clinerules", "hooks"))
		})

		it("should propagate errors when checking directory fails", async () => {
			const workspaceRoot = path.join(tempDir, "workspace1")
			await fs.mkdir(workspaceRoot, { recursive: true })

			sandbox.stub(StateManager, "get").returns({
				getGlobalStateKey: () => [{ path: workspaceRoot }],
			} as any)

			// Stub isDirectory to throw an error
			isDirectoryStub.rejects(new Error("Permission denied"))

			// Should propagate the error
			try {
				await getWorkspaceHooksDirs()
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.message.should.equal("Permission denied")
			}
		})

		it("should use correct path joining for hooks directory", async () => {
			const workspaceRoot = path.join(tempDir, "workspace1")
			const expectedHooksDir = path.join(workspaceRoot, ".clinerules", "hooks")
			await fs.mkdir(expectedHooksDir, { recursive: true })

			sandbox.stub(StateManager, "get").returns({
				getGlobalStateKey: () => [{ path: workspaceRoot }],
			} as any)

			const result = await getWorkspaceHooksDirs()
			result[0].should.equal(expectedHooksDir)
			// Verify it uses the correct path separator for the platform
			result[0].should.match(/\.clinerules[\\/]hooks$/)
		})

		it("should handle workspace roots with trailing slashes", async () => {
			const workspaceRoot = path.join(tempDir, "workspace1")
			const workspaceRootWithSlash = workspaceRoot + path.sep
			const hooksDir = path.join(workspaceRoot, ".clinerules", "hooks")
			await fs.mkdir(hooksDir, { recursive: true })

			sandbox.stub(StateManager, "get").returns({
				getGlobalStateKey: () => [{ path: workspaceRootWithSlash }],
			} as any)

			const result = await getWorkspaceHooksDirs()
			result.should.be.an.Array()
			result.length.should.equal(1)
			result[0].should.equal(hooksDir)
		})
	})

	describe("getAllHooksDirs", () => {
		it("should include the runtime hooks directory when it exists", async () => {
			const runtimeHooksDir = path.join(tempDir, "runtime-hooks")
			await fs.mkdir(runtimeHooksDir, { recursive: true })

			sandbox.stub(os, "homedir").returns(tempDir)
			sandbox.stub(StateManager, "get").returns({
				getGlobalStateKey: () => [],
			} as any)

			isDirectoryStub.callsFake(async (targetPath: string) => targetPath === runtimeHooksDir)

			setRuntimeHooksDir(runtimeHooksDir)

			const result = await getAllHooksDirs()
			result.should.containEql(runtimeHooksDir)
		})

		it("should not include the runtime hooks directory when it does not exist", async () => {
			const runtimeHooksDir = path.join(tempDir, "missing-runtime-hooks")

			sandbox.stub(os, "homedir").returns(tempDir)
			sandbox.stub(StateManager, "get").returns({
				getGlobalStateKey: () => [],
			} as any)

			isDirectoryStub.resolves(false)

			setRuntimeHooksDir(runtimeHooksDir)

			const result = await getAllHooksDirs()
			result.should.not.containEql(runtimeHooksDir)
		})
	})
})

describe("disk - atomic writes", () => {
	let sandbox: sinon.SinonSandbox
	let testGlobalStorageDir: string

	// Setup HostProvider for tests with real temp directory
	beforeAll(async () => {
		// Create a real temp directory for the tests
		testGlobalStorageDir = path.join(os.tmpdir(), `cline-test-storage-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		await fs.mkdir(testGlobalStorageDir, { recursive: true })

		// Initialize HostProvider with the real temp directory
		setVscodeHostProviderMock({
			globalStorageFsPath: testGlobalStorageDir,
		})
	})

	afterAll(async () => {
		HostProvider.reset()

		// Clean up temp directory
		try {
			await fs.rm(testGlobalStorageDir, { recursive: true, force: true })
		} catch {
			// Ignore cleanup errors
		}
	})

	beforeEach(async () => {
		sandbox = sinon.createSandbox()
	})

	afterEach(async () => {
		sandbox.restore()
	})

	it("creates and repairs MCP settings with owner-only permissions", async () => {
		const settingsDir = path.join(testGlobalStorageDir, "secure-mcp-settings")
		const settingsPath = await getMcpSettingsFilePath(settingsDir)

		if (process.platform !== "win32") {
			const directoryMode = (await fs.stat(settingsDir)).mode & 0o777
			const fileMode = (await fs.stat(settingsPath)).mode & 0o777
			directoryMode.should.equal(0o700)
			fileMode.should.equal(0o600)

			await fs.chmod(settingsDir, 0o755)
			await fs.chmod(settingsPath, 0o644)
			await getMcpSettingsFilePath(settingsDir)
			const repairedDirectoryMode = (await fs.stat(settingsDir)).mode & 0o777
			const repairedMode = (await fs.stat(settingsPath)).mode & 0o777
			repairedDirectoryMode.should.equal(0o700)
			repairedMode.should.equal(0o600)
		}
	})

	it("creates the host settings directory with owner-only permissions", async () => {
		const settingsDir = path.join(testGlobalStorageDir, "settings")
		await fs.rm(settingsDir, { recursive: true, force: true })

		const created = await ensureSettingsDirectoryExists()

		created.should.equal(settingsDir)
		if (process.platform !== "win32") {
			const directoryMode = (await fs.stat(created)).mode & 0o777
			directoryMode.should.equal(0o700)
		}
	})
})
