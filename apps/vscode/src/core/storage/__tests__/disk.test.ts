import { afterAll, afterEach, beforeAll, beforeEach, describe, it, mock } from "bun:test"
import "should"
import * as actualFsUtils from "@utils/fs"
import fs from "fs/promises"
import os from "os"
import path from "path"
import sinon from "sinon"
import { HostProvider } from "@/hosts/host-provider"
import { setVscodeHostProviderMock, stubWorkspacePaths } from "@/test/host-provider-test-utils"

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

import { getAllHooksDirs, getWindowWorkspaceRoots, getWorkspaceHooksDirs, setRuntimeHooksDir } from "../disk"

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
		it("should return empty array when the window has no workspace folders", async () => {
			stubWorkspacePaths(sandbox, [])

			const result = await getWorkspaceHooksDirs()
			result.should.be.an.Array()
			result.length.should.equal(0)
		})

		it("should return empty array when no hooks directories exist", async () => {
			// Create workspace root without hooks directory
			const workspaceRoot = path.join(tempDir, "workspace1")
			await fs.mkdir(workspaceRoot, { recursive: true })

			stubWorkspacePaths(sandbox, [workspaceRoot])

			const result = await getWorkspaceHooksDirs()
			result.should.be.an.Array()
			result.length.should.equal(0)
		})

		it("should return hooks directory when it exists", async () => {
			// Create workspace root with hooks directory
			const workspaceRoot = path.join(tempDir, "workspace1")
			const hooksDir = path.join(workspaceRoot, ".clinerules", "hooks")
			await fs.mkdir(hooksDir, { recursive: true })

			stubWorkspacePaths(sandbox, [workspaceRoot])

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

			stubWorkspacePaths(sandbox, [workspaceRoot])

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

			stubWorkspacePaths(sandbox, [workspaceRoot1, workspaceRoot2])

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

			stubWorkspacePaths(sandbox, [workspaceRoot1, workspaceRoot2, workspaceRoot3])

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

			stubWorkspacePaths(sandbox, [workspaceRoot])

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

			stubWorkspacePaths(sandbox, [workspaceRoot])

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

			stubWorkspacePaths(sandbox, [workspaceRootWithSlash])

			const result = await getWorkspaceHooksDirs()
			result.should.be.an.Array()
			result.length.should.equal(1)
			result[0].should.equal(hooksDir)
		})
	})

	describe("getWindowWorkspaceRoots", () => {
		it("should filter out blank workspace paths", async () => {
			const workspaceRoot = path.join(tempDir, "workspace1")
			stubWorkspacePaths(sandbox, ["", "   ", workspaceRoot])

			const result = await getWindowWorkspaceRoots()
			result.should.eql([workspaceRoot])
		})

		it("should return empty array when the host lookup fails", async () => {
			sandbox.stub(HostProvider, "workspace").get(() => ({
				getWorkspacePaths: async () => {
					throw new Error("host bridge unavailable")
				},
			}))

			const result = await getWindowWorkspaceRoots()
			result.should.eql([])
		})
	})

	describe("getAllHooksDirs", () => {
		it("should include the runtime hooks directory when it exists", async () => {
			const runtimeHooksDir = path.join(tempDir, "runtime-hooks")
			await fs.mkdir(runtimeHooksDir, { recursive: true })

			sandbox.stub(os, "homedir").returns(tempDir)
			stubWorkspacePaths(sandbox, [])

			isDirectoryStub.callsFake(async (targetPath: string) => targetPath === runtimeHooksDir)

			setRuntimeHooksDir(runtimeHooksDir)

			const result = await getAllHooksDirs()
			result.should.containEql(runtimeHooksDir)
		})

		it("should not include the runtime hooks directory when it does not exist", async () => {
			const runtimeHooksDir = path.join(tempDir, "missing-runtime-hooks")

			sandbox.stub(os, "homedir").returns(tempDir)
			stubWorkspacePaths(sandbox, [])

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
})
