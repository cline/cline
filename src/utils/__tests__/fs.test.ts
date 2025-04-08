import { describe, it, expect, afterAll } from "vitest"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { createDirectoriesForFile, fileExistsAtPath, isDirectory } from "../fs"

describe("Filesystem Utilities", () => {
	const tmpDir = path.join(os.tmpdir(), "cline-test-" + Math.random().toString(36).slice(2))

	// Clean up after tests
	afterAll(async () => {
		try {
			await fs.rm(tmpDir, { recursive: true, force: true })
		} catch {
			// Ignore cleanup errors
		}
	})

	describe("fileExistsAtPath", () => {
		it("should return true for existing paths", async () => {
			await fs.mkdir(tmpDir, { recursive: true })
			const testFile = path.join(tmpDir, "test.txt")
			await fs.writeFile(testFile, "test")

			const exists = await fileExistsAtPath(testFile)
			expect(exists).toBe(true)
		})

		it("should return false for non-existing paths", async () => {
			const nonExistentPath = path.join(tmpDir, "does-not-exist.txt")
			const exists = await fileExistsAtPath(nonExistentPath)
			expect(exists).toBe(false)
		})
	})

	describe("createDirectoriesForFile", () => {
		it("should create all necessary directories", async () => {
			const deepPath = path.join(tmpDir, "deep", "nested", "dir", "file.txt")
			const createdDirs = await createDirectoriesForFile(deepPath)

			// Verify directories were created
			expect(createdDirs.length).toBeGreaterThan(0)
			for (const dir of createdDirs) {
				const exists = await fileExistsAtPath(dir)
				expect(exists).toBe(true)
			}
		})

		it("should handle existing directories", async () => {
			const existingDir = path.join(tmpDir, "existing")
			await fs.mkdir(existingDir, { recursive: true })

			const filePath = path.join(existingDir, "file.txt")
			const createdDirs = await createDirectoriesForFile(filePath)

			// Should not create any new directories
			expect(createdDirs.length).toBe(0)
		})

		it("should normalize paths", async () => {
			const unnormalizedPath = path.join(tmpDir, "a", "..", "b", ".", "file.txt")
			const createdDirs = await createDirectoriesForFile(unnormalizedPath)

			// Should create only the necessary directory
			expect(createdDirs.length).toBe(1)
			const exists = await fileExistsAtPath(path.join(tmpDir, "b"))
			expect(exists).toBe(true)
		})
	})
	describe("isDirectory", () => {
		it("should return true for directories", async () => {
			await fs.mkdir(tmpDir, { recursive: true })
			const isDir = await isDirectory(tmpDir)
			expect(isDir).toBe(true)
		})

		it("should return false for files", async () => {
			const testFile = path.join(tmpDir, "test.txt")
			await fs.writeFile(testFile, "test")
			const isDir = await isDirectory(testFile)
			expect(isDir).toBe(false)
		})

		it("should return false for non-existent paths", async () => {
			const nonExistentPath = path.join(tmpDir, "does-not-exist")
			const isDir = await isDirectory(nonExistentPath)
			expect(isDir).toBe(false)
		})
	})
})
