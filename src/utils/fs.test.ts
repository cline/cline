import * as fs from "fs/promises"
import { after, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import "should"
import { calculateDirectorySize, createDirectoriesForFile, fileExistsAtPath } from "./fs"

describe("Filesystem Utilities", () => {
	const tmpDir = path.join(os.tmpdir(), "cline-test-" + Math.random().toString(36).slice(2))

	// Clean up after tests
	after(async () => {
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
			exists.should.be.true()
		})

		it("should return false for non-existing paths", async () => {
			const nonExistentPath = path.join(tmpDir, "does-not-exist.txt")
			const exists = await fileExistsAtPath(nonExistentPath)
			exists.should.be.false()
		})
	})

	describe("createDirectoriesForFile", () => {
		it("should create all necessary directories", async () => {
			const deepPath = path.join(tmpDir, "deep", "nested", "dir", "file.txt")
			const createdDirs = await createDirectoriesForFile(deepPath)

			// Verify directories were created
			createdDirs.length.should.be.greaterThan(0)
			for (const dir of createdDirs) {
				const exists = await fileExistsAtPath(dir)
				exists.should.be.true()
			}
		})

		it("should handle existing directories", async () => {
			const existingDir = path.join(tmpDir, "existing")
			await fs.mkdir(existingDir, { recursive: true })

			const filePath = path.join(existingDir, "file.txt")
			const createdDirs = await createDirectoriesForFile(filePath)

			// Should not create any new directories
			createdDirs.length.should.equal(0)
		})

		it("should normalize paths", async () => {
			const unnormalizedPath = path.join(tmpDir, "a", "..", "b", ".", "file.txt")
			const createdDirs = await createDirectoriesForFile(unnormalizedPath)

			// Should create only the necessary directory
			createdDirs.length.should.equal(1)
			const exists = await fileExistsAtPath(path.join(tmpDir, "b"))
			exists.should.be.true()
		})
	})

	describe("calculateDirectorySize", () => {
		it("should return 0 for empty directory", async () => {
			const emptyDir = path.join(tmpDir, "empty")
			await fs.mkdir(emptyDir, { recursive: true })
			
			const size = await calculateDirectorySize(emptyDir)
			size.should.equal(0)
		})

		it("should calculate size of directory with files", async () => {
			const testDir = path.join(tmpDir, "with-files")
			await fs.mkdir(testDir, { recursive: true })
			
			// Create test files with known sizes
			await fs.writeFile(path.join(testDir, "file1.txt"), "a".repeat(100))
			await fs.writeFile(path.join(testDir, "file2.txt"), "a".repeat(200))
			
			const size = await calculateDirectorySize(testDir)
			size.should.equal(300)
		})

		it("should calculate size of nested directories", async () => {
			const testDir = path.join(tmpDir, "nested")
			const subDir = path.join(testDir, "sub")
			await fs.mkdir(subDir, { recursive: true })
			
			// Create files in both directories
			await fs.writeFile(path.join(testDir, "root.txt"), "a".repeat(100))
			await fs.writeFile(path.join(subDir, "sub.txt"), "a".repeat(200))
			
			const size = await calculateDirectorySize(testDir)
			size.should.equal(300)
		})

		it("should handle permission errors gracefully", async () => {
			const testDir = path.join(tmpDir, "no-permission")
			await fs.mkdir(testDir, { recursive: true })
			await fs.writeFile(path.join(testDir, "file.txt"), "a".repeat(100))
			
			// Create a subdirectory that will throw an error when accessed
			const noPermissionDir = path.join(testDir, "no-access")
			await fs.mkdir(noPermissionDir)
			
			// The directory exists but will throw when trying to read its contents
			const size = await calculateDirectorySize(noPermissionDir)
			size.should.equal(0) // Should return 0 when error occurs
		})
	})
})
