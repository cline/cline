import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import { HistoryItem } from "@shared/HistoryItem"
import * as fsUtils from "@utils/fs"
import fs from "fs/promises"
import os from "os"
import path from "path"
import sinon from "sinon"
import { HostProvider } from "@/hosts/host-provider"
import { setVscodeHostProviderMock } from "@/test/host-provider-test-utils"
import {
	ensureStateDirectoryExists,
	getTaskHistoryStateFilePath,
	getWorkspaceHooksDirs,
	readTaskHistoryFromState,
	writeTaskHistoryToState,
} from "../disk"
import { StateManager } from "../StateManager"

describe("disk - hooks functionality", () => {
	let sandbox: sinon.SinonSandbox
	let tempDir: string

	beforeEach(async () => {
		sandbox = sinon.createSandbox()
		tempDir = path.join(os.tmpdir(), `disk-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		await fs.mkdir(tempDir, { recursive: true })
	})

	afterEach(async () => {
		sandbox.restore()
		try {
			await fs.rm(tempDir, { recursive: true, force: true })
		} catch (error) {
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
			sandbox.stub(fsUtils, "isDirectory").rejects(new Error("Permission denied"))

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
})

describe("disk - atomic writes", () => {
	let sandbox: sinon.SinonSandbox
	let testGlobalStorageDir: string

	// Setup HostProvider for tests with real temp directory
	before(async () => {
		// Create a real temp directory for the tests
		testGlobalStorageDir = path.join(os.tmpdir(), `cline-test-storage-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		await fs.mkdir(testGlobalStorageDir, { recursive: true })

		// Initialize HostProvider with the real temp directory
		setVscodeHostProviderMock({
			globalStorageFsPath: testGlobalStorageDir,
		})
	})

	after(async () => {
		HostProvider.reset()

		// Clean up temp directory
		try {
			await fs.rm(testGlobalStorageDir, { recursive: true, force: true })
		} catch {
			// Ignore cleanup errors
		}
	})

	/**
	 * Helper to create test history items
	 */
	const createTestHistoryItem = (id: string, task: string): HistoryItem => {
		return {
			id,
			ts: Date.now(),
			task,
			tokensIn: 100,
			tokensOut: 200,
			totalCost: 0.01,
		}
	}

	/**
	 * Helper to check for orphaned temp files
	 */
	const getTempFileCount = async (): Promise<number> => {
		const stateDir = await ensureStateDirectoryExists()
		const files = await fs.readdir(stateDir)
		return files.filter((f) => f.startsWith("taskHistory.json.tmp.")).length
	}

	beforeEach(async () => {
		sandbox = sinon.createSandbox()
	})

	afterEach(async () => {
		sandbox.restore()
	})

	describe("writeTaskHistoryToState and readTaskHistoryFromState", () => {
		it("should write and read task history correctly", async () => {
			const items = [createTestHistoryItem("test-1", "Build a todo app"), createTestHistoryItem("test-2", "Fix a bug")]

			await writeTaskHistoryToState(items)
			const result = await readTaskHistoryFromState()

			result.should.be.an.Array()
			result.should.have.length(2)
			result[0].id.should.equal("test-1")
			result[0].task.should.equal("Build a todo app")
			result[1].id.should.equal("test-2")
			result[1].task.should.equal("Fix a bug")
		})

		it("should write valid JSON that can be parsed", async () => {
			const items = [
				createTestHistoryItem("test-json-1", "Test with special chars: 你好 🎉"),
				createTestHistoryItem("test-json-2", "Test with quotes: \"hello\" and 'world'"),
			]

			await writeTaskHistoryToState(items)

			// Read the raw file and verify it's valid JSON
			const filePath = await getTaskHistoryStateFilePath()
			const rawContent = await fs.readFile(filePath, "utf8")
			const parsed = JSON.parse(rawContent) // Should not throw

			parsed.should.be.an.Array()
			parsed.should.have.length(2)
		})

		it("should not leave temp files after successful write", async () => {
			const items = [createTestHistoryItem("cleanup-test", "Test cleanup")]

			const tempCountBefore = await getTempFileCount()
			await writeTaskHistoryToState(items)
			const tempCountAfter = await getTempFileCount()

			tempCountAfter.should.equal(tempCountBefore)
		})

		it("should handle empty array writes", async () => {
			await writeTaskHistoryToState([])
			const result = await readTaskHistoryFromState()

			result.should.be.an.Array()
			result.should.have.length(0)
		})

		it("should handle large task history arrays", async function () {
			this.timeout(30000) // 30 second timeout for large file operations

			// Create large task content by repeating a pattern (each task ~50 KB)
			const baseContent = "X".repeat(50 * 1024) // 50 KB of X's per task

			// Create 1,000 history items (resulting in ~50 MB file)
			const items = Array.from({ length: 1000 }, (_, i) =>
				createTestHistoryItem(`stress-test-${i}`, `Task ${i}: ${baseContent}`),
			)

			await writeTaskHistoryToState(items)
			const result = await readTaskHistoryFromState()

			// Verify array length and data integrity
			result.should.have.length(1000)
			result[0].id.should.equal("stress-test-0")
			result[0].task.should.startWith("Task 0: X")
			result[500].id.should.equal("stress-test-500")
			result[999].id.should.equal("stress-test-999")
		})

		it("should handle concurrent writes without corruption", async function () {
			this.timeout(30000)

			// Perform many concurrent writes to stress test atomicity
			const writePromises = Array.from({ length: 100 }, (_, i) => {
				const items = [createTestHistoryItem(`concurrent-${i}`, `Task ${i}`)]
				return writeTaskHistoryToState(items).catch((error) => {
					// On Windows, concurrent renames may fail with EPERM - this is expected
					if (process.platform === "win32" && error.code === "EPERM") {
						return // Expected Windows behavior
					}
					throw error // Unexpected error, rethrow
				})
			})

			// Wait for all writes to complete (some may fail on Windows with EPERM)
			await Promise.all(writePromises)

			// Final read should return valid JSON (not corrupted)
			const result = await readTaskHistoryFromState()
			result.should.be.an.Array()
			// Should have data from one of the concurrent writes that succeeded
			result.length.should.be.greaterThan(0)
			// Verify the data is valid (not corrupted)
			result[0].should.have.property("id")
			result[0].should.have.property("task")
		})

		it("should preserve data integrity with special characters", async () => {
			const items = [
				createTestHistoryItem("special-1", "Test\nwith\nnewlines"),
				createTestHistoryItem("special-2", "Test\twith\ttabs"),
				createTestHistoryItem("special-3", "Test with unicode: 日本語 中文 한국어"),
				createTestHistoryItem("special-4", "Test with emojis: 😀🎉🚀"),
			]

			await writeTaskHistoryToState(items)
			const result = await readTaskHistoryFromState()

			result.should.have.length(4)
			result[0].task.should.equal("Test\nwith\nnewlines")
			result[1].task.should.equal("Test\twith\ttabs")
			result[2].task.should.equal("Test with unicode: 日本語 中文 한국어")
			result[3].task.should.equal("Test with emojis: 😀🎉🚀")
		})

		it("should overwrite existing task history", async () => {
			// Write initial data
			const initialItems = [createTestHistoryItem("initial-1", "Initial task")]
			await writeTaskHistoryToState(initialItems)

			// Verify initial data
			let result = await readTaskHistoryFromState()
			result.should.have.length(1)
			result[0].id.should.equal("initial-1")

			// Overwrite with new data
			const newItems = [createTestHistoryItem("new-1", "New task 1"), createTestHistoryItem("new-2", "New task 2")]
			await writeTaskHistoryToState(newItems)

			// Verify new data replaced old data
			result = await readTaskHistoryFromState()
			result.should.have.length(2)
			result[0].id.should.equal("new-1")
			result[1].id.should.equal("new-2")
		})

		it("should handle rapid successive writes", async function () {
			this.timeout(5000)

			// Perform rapid successive writes (not concurrent)
			for (let i = 0; i < 20; i++) {
				const items = [createTestHistoryItem(`rapid-${i}`, `Task ${i}`)]
				await writeTaskHistoryToState(items)
			}

			// Should have no temp files left
			const tempCount = await getTempFileCount()
			tempCount.should.equal(0)

			// Final read should be valid
			const result = await readTaskHistoryFromState()
			result.should.be.an.Array()
			result.should.have.length(1)
			result[0].id.should.equal("rapid-19")
		})

		it("should preserve all HistoryItem fields", async () => {
			const items = [
				{
					id: "full-test",
					ts: 1234567890,
					task: "Complete task",
					tokensIn: 500,
					tokensOut: 1000,
					totalCost: 0.15,
					cacheWrites: 100,
					cacheReads: 200,
				},
			]

			await writeTaskHistoryToState(items)
			const result = await readTaskHistoryFromState()

			result.should.have.length(1)
			result[0].id.should.equal("full-test")
			result[0].ts.should.equal(1234567890)
			result[0].task.should.equal("Complete task")
			result[0].tokensIn.should.equal(500)
			result[0].tokensOut.should.equal(1000)
			result[0].totalCost.should.equal(0.15)
			result[0].cacheWrites!.should.equal(100)
			result[0].cacheReads!.should.equal(200)
		})
	})

	describe("atomic write failure scenarios", () => {
		it("should leave original file intact if temp file write fails", async () => {
			// Write initial data
			const initialItems = [createTestHistoryItem("original-1", "Original task")]
			await writeTaskHistoryToState(initialItems)

			// Verify initial data exists
			let result = await readTaskHistoryFromState()
			result.should.have.length(1)
			result[0].id.should.equal("original-1")

			// Stub fs.writeFile to fail during temp file creation
			const writeFileStub = sandbox.stub(fs, "writeFile")
			writeFileStub.rejects(new Error("Simulated write failure"))

			// Attempt to write new data (should fail)
			const newItems = [createTestHistoryItem("new-1", "New task")]
			try {
				await writeTaskHistoryToState(newItems)
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.message.should.equal("Simulated write failure")
			}

			// Original file should still be intact
			result = await readTaskHistoryFromState()
			result.should.have.length(1)
			result[0].id.should.equal("original-1")

			// No temp files should remain
			const tempCount = await getTempFileCount()
			tempCount.should.equal(0)
		})

		it("should leave original file intact if rename fails", async () => {
			// Write initial data
			const initialItems = [createTestHistoryItem("original-2", "Original task 2")]
			await writeTaskHistoryToState(initialItems)

			// Verify initial data exists
			let result = await readTaskHistoryFromState()
			result.should.have.length(1)
			result[0].id.should.equal("original-2")

			// Stub fs.rename to fail
			const renameStub = sandbox.stub(fs, "rename")
			renameStub.rejects(new Error("Simulated rename failure"))

			// Attempt to write new data (should fail)
			const newItems = [createTestHistoryItem("new-2", "New task 2")]
			try {
				await writeTaskHistoryToState(newItems)
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.message.should.equal("Simulated rename failure")
			}

			// Original file should still be intact
			result = await readTaskHistoryFromState()
			result.should.have.length(1)
			result[0].id.should.equal("original-2")

			// Temp file cleanup may or may not succeed, but original file is safe
			// (The atomicWriteFile function attempts cleanup but doesn't throw if it fails)
		})

		it("should ignore temp files during read operations", async () => {
			// Write valid data
			const items = [createTestHistoryItem("valid-1", "Valid task")]
			await writeTaskHistoryToState(items)

			// Create a corrupt temp file manually
			const stateDir = await ensureStateDirectoryExists()
			const corruptTempPath = path.join(stateDir, "taskHistory.json.tmp.12345.corrupt")
			await fs.writeFile(corruptTempPath, "INVALID JSON{", "utf8")

			// Read should succeed and ignore the temp file
			const result = await readTaskHistoryFromState()
			result.should.have.length(1)
			result[0].id.should.equal("valid-1")

			// Cleanup temp file
			await fs.unlink(corruptTempPath)
		})

		it("should handle concurrent read during write without corruption", async () => {
			// Write initial data
			const initialItems = [createTestHistoryItem("concurrent-read-1", "Initial task")]
			await writeTaskHistoryToState(initialItems)

			// Create a slow rename by stubbing fs.rename to delay
			// This simulates the critical window where temp file is written but rename hasn't occurred
			let renameResolve: () => void
			const renamePromise = new Promise<void>((resolve) => {
				renameResolve = resolve
			})

			const originalRename = fs.rename
			const renameStub = sandbox.stub(fs, "rename")
			renameStub.callsFake(async (oldPath, newPath) => {
				// Delay the rename operation
				await renamePromise // Wait for our signal
				return originalRename(oldPath, newPath)
			})

			// Start a write operation (rename will be delayed)
			const newItems = [createTestHistoryItem("concurrent-read-2", "New task")]
			const writeOperation = writeTaskHistoryToState(newItems)

			// Give temp file time to be written, but before rename completes
			await new Promise((resolve) => setTimeout(resolve, 50))

			// Perform a read during the critical window (temp file exists, but rename hasn't happened)
			const readResult = await readTaskHistoryFromState()

			// Should get old data (since rename hasn't completed yet)
			readResult.should.have.length(1)
			readResult[0].id.should.equal("concurrent-read-1")

			// Now allow rename to complete
			renameResolve!()
			await writeOperation

			// Subsequent read should get new data
			const finalResult = await readTaskHistoryFromState()
			finalResult.should.have.length(1)
			finalResult[0].id.should.equal("concurrent-read-2")
		})

		it("should handle partial temp file from interrupted process", async () => {
			// Write initial valid data
			const initialItems = [createTestHistoryItem("partial-test-1", "Initial task")]
			await writeTaskHistoryToState(initialItems)

			// Simulate an interrupted write by creating a partial temp file
			const stateDir = await ensureStateDirectoryExists()
			const partialTempPath = path.join(stateDir, "taskHistory.json.tmp.99999.partial")

			// Write only part of a valid JSON array
			await fs.writeFile(partialTempPath, '[{"id":"partial","ts":123456789', "utf8")

			// Read should succeed with original data
			const result = await readTaskHistoryFromState()
			result.should.have.length(1)
			result[0].id.should.equal("partial-test-1")

			// Write new data should succeed and clean up
			const newItems = [createTestHistoryItem("partial-test-2", "New task")]
			await writeTaskHistoryToState(newItems)

			// Verify new data
			const finalResult = await readTaskHistoryFromState()
			finalResult.should.have.length(1)
			finalResult[0].id.should.equal("partial-test-2")

			// Cleanup our partial temp file if it still exists
			try {
				await fs.unlink(partialTempPath)
			} catch {
				// May already be cleaned up
			}
		})
	})
})
