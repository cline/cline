import * as fs from "fs/promises"
import { after, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import "should"
import { createDirectoriesForFile, fileExistsAtPath, isDirectory, readDirectory } from "./fs"

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
	describe("isDirectory", () => {
		it("should return true for directories", async () => {
			await fs.mkdir(tmpDir, { recursive: true })
			const isDir = await isDirectory(tmpDir)
			isDir.should.be.true()
		})

		it("should return false for files", async () => {
			const testFile = path.join(tmpDir, "test.txt")
			await fs.writeFile(testFile, "test")
			const isDir = await isDirectory(testFile)
			isDir.should.be.false()
		})

		it("should return false for non-existent paths", async () => {
			const nonExistentPath = path.join(tmpDir, "does-not-exist")
			const isDir = await isDirectory(nonExistentPath)
			isDir.should.be.false()
		})
	})

	describe("readDirectory", () => {
		it("should return a list of files in a directory", async () => {
			const testDir = path.join(tmpDir, "read-test")
			await fs.mkdir(testDir, { recursive: true })

			const file1 = path.join(testDir, "file1.txt")
			const file2 = path.join(testDir, "file2.txt")
			await fs.writeFile(file1, "test1")
			await fs.writeFile(file2, "test2")

			const subDir = path.join(testDir, "subdir")
			await fs.mkdir(subDir, { recursive: true })
			const file3 = path.join(subDir, "file3.txt")
			await fs.writeFile(file3, "test3")

			const files = await readDirectory(testDir)
			files.length.should.equal(3)
			files.should.containDeep([path.resolve(file1), path.resolve(file2), path.resolve(file3)])
		})

		it("should handle symlinks to files", async () => {
			const testDir = path.join(tmpDir, "symlink-test")
			await fs.mkdir(testDir, { recursive: true })

			const realFile = path.join(testDir, "real-file.txt")
			const symlinkFile = path.join(testDir, "symlink-file.txt")
			await fs.writeFile(realFile, "real file content")
			await fs.symlink(realFile, symlinkFile)

			const files = await readDirectory(testDir)
			files.length.should.equal(2)
			files.should.containDeep([path.resolve(realFile), path.resolve(symlinkFile)])
		})

		it("should handle symlinks to directories", async () => {
			const testDir = path.join(tmpDir, "symlink-dir-test")
			const targetDir = path.join(tmpDir, "target-dir")
			const symlinkDir = path.join(testDir, "symlink-dir")

			await fs.mkdir(testDir, { recursive: true })
			await fs.mkdir(targetDir, { recursive: true })

			const targetFile = path.join(targetDir, "target-file.txt")
			await fs.writeFile(targetFile, "target file content")

			await fs.symlink(targetDir, symlinkDir)

			const files = await readDirectory(testDir)
			files.length.should.equal(1)
			files.should.containDeep([path.resolve(path.join(symlinkDir, "target-file.txt"))])
		})

		it("should throw an error for non-existent directories", async () => {
			const nonExistentDir = path.join(tmpDir, "does-not-exist")
			try {
				await readDirectory(nonExistentDir)
			} catch (error) {
				error.should.be.an.instanceOf(Error)
			}
		})
	})
})
