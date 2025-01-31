import { describe, it, after, beforeEach } from "mocha"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { expect } from "chai"
import {
	getDefaultExclusions,
	getLfsPatterns,
	shouldExcludeFile,
	initializeCache,
	writeExcludesFile,
} from "../../integrations/checkpoints/CheckpointExclusions"
import { GIT_DISABLED_SUFFIX } from "../../integrations/checkpoints/CheckpointTracker"
import { fileExistsAtPath } from "../../utils/fs"

describe("CheckpointExclusions", () => {
	beforeEach(() => {
		// Reset cache before each test
		initializeCache(getDefaultExclusions())
	})

	describe("getDefaultExclusions", () => {
		it("should return an array of exclusion patterns", () => {
			const exclusions = getDefaultExclusions()

			// Verify return type
			expect(exclusions).to.be.an("array")
			expect(exclusions.length).to.be.greaterThan(0)

			// Verify all items are strings
			expect(exclusions.every((item: string) => typeof item === "string")).to.be.true

			// Verify it includes critical patterns
			expect(exclusions).to.include(".git/")
			expect(exclusions).to.include("node_modules/")

			// Verify pattern formats
			const directories = exclusions.filter((pattern: string) => pattern.endsWith("/"))
			const extensions = exclusions.filter((pattern: string) => pattern.startsWith("*."))

			// Should have both directory and extension patterns
			expect(directories.length).to.be.greaterThan(0)
			expect(extensions.length).to.be.greaterThan(0)
		})

		it("should include provided LFS patterns", () => {
			const lfsPatterns = ["*.bin", "*.dat"]
			const exclusions = getDefaultExclusions(lfsPatterns)

			// Should include all LFS patterns
			lfsPatterns.forEach((pattern) => {
				expect(exclusions).to.include(pattern)
			})
		})
	})

	describe("writeExcludesFile", () => {
		const tmpDir = path.join(os.tmpdir(), "cline-test-" + Math.random().toString(36).slice(2))
		const gitPath = path.join(tmpDir, ".git")

		// Clean up after tests
		after(async () => {
			try {
				await fs.rm(tmpDir, { recursive: true, force: true })
			} catch {
				// Ignore cleanup errors
			}
		})

		beforeEach(async () => {
			await fs.mkdir(tmpDir, { recursive: true })
		})

		it("should create exclude file with patterns", async () => {
			await writeExcludesFile(gitPath)

			// Verify exclude file exists and has content
			const excludePath = path.join(gitPath, "info", "exclude")
			const exists = await fileExistsAtPath(excludePath)
			expect(exists).to.be.true

			// Read and verify content
			const content = await fs.readFile(excludePath, "utf8")
			const patterns = content.split("\n")

			// Check for some expected patterns
			expect(patterns).to.include(".git/")
			expect(patterns).to.include("node_modules/")
			expect(patterns).to.include("*.jpg")
		})

		it("should include LFS patterns in exclude file", async () => {
			const lfsPatterns = ["*.bin", "*.dat"]
			await writeExcludesFile(gitPath, lfsPatterns)

			const excludePath = path.join(gitPath, "info", "exclude")
			const content = await fs.readFile(excludePath, "utf8")
			const patterns = content.split("\n")

			// Verify LFS patterns are included
			lfsPatterns.forEach((pattern) => {
				expect(patterns).to.include(pattern)
			})
		})

		it("should create info directory if it doesn't exist", async () => {
			await writeExcludesFile(gitPath)

			const infoPath = path.join(gitPath, "info")
			const exists = await fileExistsAtPath(infoPath)
			expect(exists).to.be.true
		})

		it("should reinitialize cache with new patterns", async () => {
			const lfsPatterns = ["*.custom"]
			await writeExcludesFile(gitPath, lfsPatterns)

			// Test cache state by checking a file with custom extension
			const testPath = path.join(tmpDir, "test.custom")
			await fs.writeFile(testPath, "content")

			const result = await shouldExcludeFile(testPath)
			expect(result.excluded).to.be.true
			expect(result.reason).to.equal("File extension .custom is excluded")
		})
	})

	describe("shouldExcludeFile", () => {
		const tmpDir = path.join(os.tmpdir(), "cline-test-" + Math.random().toString(36).slice(2))

		// Clean up after tests
		after(async () => {
			try {
				await fs.rm(tmpDir, { recursive: true, force: true })
			} catch {
				// Ignore cleanup errors
			}
		})

		beforeEach(async () => {
			await fs.mkdir(tmpDir, { recursive: true })
		})

		it("should exclude files in excluded directories", async () => {
			const nodePath = path.join(tmpDir, "node_modules", "package", "file.js")
			await fs.mkdir(path.dirname(nodePath), { recursive: true })
			await fs.writeFile(nodePath, "content")

			const result = await shouldExcludeFile(nodePath)
			expect(result.excluded).to.be.true
			expect(result.reason).to.equal("Directory matches excluded pattern: node_modules")
		})

		it("should exclude files with excluded extensions", async () => {
			const imagePath = path.join(tmpDir, "image.jpg")
			await fs.writeFile(imagePath, "fake image content")

			const result = await shouldExcludeFile(imagePath)
			expect(result.excluded).to.be.true
			expect(result.reason).to.equal("File extension .jpg is excluded")
		})

		it("should exclude files over size limit", async () => {
			const largePath = path.join(tmpDir, "large-file.txt")
			// Create a 6MB file using a string
			const content = "x".repeat(6 * 1024 * 1024)
			await fs.writeFile(largePath, content)

			const result = await shouldExcludeFile(largePath)
			expect(result.excluded).to.be.true
			expect(result.reason).to.match(/File size \d+\.\d+MB exceeds 5MB limit/)
		})

		it("should not exclude normal files", async () => {
			const normalPath = path.join(tmpDir, "normal.ts")
			await fs.writeFile(normalPath, "export const x = 1")

			const result = await shouldExcludeFile(normalPath)
			expect(result.excluded).to.be.false
			expect(result.reason).to.be.undefined
		})

		it("should handle nested excluded directories", async () => {
			const nestedPath = path.join(tmpDir, "src", "coverage", "report.html")
			await fs.mkdir(path.dirname(nestedPath), { recursive: true })
			await fs.writeFile(nestedPath, "<html>")

			const result = await shouldExcludeFile(nestedPath)
			expect(result.excluded).to.be.true
			expect(result.reason).to.equal("Directory matches excluded pattern: coverage")
		})

		it("should handle Windows-style paths", async () => {
			const windowsPath = path.join(tmpDir, "node_modules", "package").replace(/\//g, "\\")
			await fs.mkdir(windowsPath, { recursive: true })
			const filePath = path.join(windowsPath, "file.js")
			await fs.writeFile(filePath, "content")

			const result = await shouldExcludeFile(filePath)
			expect(result.excluded).to.be.true
			expect(result.reason).to.equal("Directory matches excluded pattern: node_modules")
		})

		it("should exclude disabled git directories", async () => {
			const gitDisabledPath = path.join(tmpDir, "nested", `.git${GIT_DISABLED_SUFFIX}`, "config")
			await fs.mkdir(path.dirname(gitDisabledPath), { recursive: true })
			await fs.writeFile(gitDisabledPath, "content")

			const result = await shouldExcludeFile(gitDisabledPath)
			expect(result.excluded).to.be.true
			expect(result.reason).to.equal(`Directory matches excluded pattern: .git${GIT_DISABLED_SUFFIX}`)
		})

		it("should handle special characters in paths", async () => {
			const specialPath = path.join(tmpDir, "folder with spaces", "file with 你好.txt")
			await fs.mkdir(path.dirname(specialPath), { recursive: true })
			await fs.writeFile(specialPath, "content")

			const result = await shouldExcludeFile(specialPath)
			expect(result.excluded).to.be.false
			expect(result.reason).to.be.undefined

			// Test with excluded directory containing special chars
			const excludedPath = path.join(tmpDir, "node_modules with spaces", "package", "file.js")
			await fs.mkdir(path.dirname(excludedPath), { recursive: true })
			await fs.writeFile(excludedPath, "content")

			const excludedResult = await shouldExcludeFile(excludedPath)
			expect(excludedResult.excluded).to.be.true
			expect(excludedResult.reason).to.equal("Directory matches excluded pattern: node_modules")
		})

		it("should handle files matching multiple exclusion criteria", async () => {
			// Create a large file in an excluded directory
			const largePath = path.join(tmpDir, "node_modules", "large-file.jpg")
			await fs.mkdir(path.dirname(largePath), { recursive: true })
			const content = "x".repeat(6 * 1024 * 1024) // 6MB
			await fs.writeFile(largePath, content)

			const result = await shouldExcludeFile(largePath)
			expect(result.excluded).to.be.true
			// Should match first exclusion reason (directory) rather than checking all
			expect(result.reason).to.equal("Directory matches excluded pattern: node_modules")
		})

		it("should handle filesystem errors gracefully ( ^^^ ENOENT/EACCES file size check errors)", async () => {
			// Test with non-existent file
			const nonExistentPath = path.join(tmpDir, "does-not-exist.txt")
			const result = await shouldExcludeFile(nonExistentPath)
			expect(result.excluded).to.be.false
			expect(result.reason).to.be.undefined

			// Test with inaccessible directory
			const inaccessiblePath = path.join(tmpDir, "no-access")
			await fs.mkdir(inaccessiblePath, { recursive: true })
			await fs.chmod(inaccessiblePath, 0) // Remove all permissions

			const filePath = path.join(inaccessiblePath, "file.txt")
			const inaccessibleResult = await shouldExcludeFile(filePath)
			expect(inaccessibleResult.excluded).to.be.false
			expect(inaccessibleResult.reason).to.be.undefined

			// Restore permissions for cleanup
			await fs.chmod(inaccessiblePath, 0o777)
		})
	})

	describe("getLfsPatterns", () => {
		const tmpDir = path.join(os.tmpdir(), "cline-test-" + Math.random().toString(36).slice(2))

		// Clean up after tests
		after(async () => {
			try {
				await fs.rm(tmpDir, { recursive: true, force: true })
			} catch {
				// Ignore cleanup errors
			}
		})

		beforeEach(async () => {
			await fs.mkdir(tmpDir, { recursive: true })
		})

		it("should extract LFS patterns from .gitattributes", async () => {
			const gitattributesPath = path.join(tmpDir, ".gitattributes")
			const content = [
				"*.bin filter=lfs diff=lfs merge=lfs",
				"*.dat filter=lfs diff=lfs",
				"# Comment line",
				"*.txt",
				"*.png filter=lfs",
			].join("\n")

			await fs.writeFile(gitattributesPath, content)

			const patterns = await getLfsPatterns(tmpDir)
			expect(patterns).to.be.an("array")
			expect(patterns).to.include("*.bin")
			expect(patterns).to.include("*.dat")
			expect(patterns).to.include("*.png")
			expect(patterns).to.have.lengthOf(3)
		})

		it("should return empty array if .gitattributes doesn't exist", async () => {
			const patterns = await getLfsPatterns(path.join(tmpDir, "non-existent"))
			expect(patterns).to.be.an("array")
			expect(patterns).to.be.empty
		})

		it("should handle malformed .gitattributes content", async () => {
			const gitattributesPath = path.join(tmpDir, ".gitattributes")
			const content = ["invalid line", "*.mp4 filter=lfs", "", "  # Comment", "*.iso filter=lfs"].join("\n")

			await fs.writeFile(gitattributesPath, content)

			const patterns = await getLfsPatterns(tmpDir)
			expect(patterns).to.be.an("array")
			expect(patterns).to.include("*.mp4")
			expect(patterns).to.include("*.iso")
			expect(patterns).to.have.lengthOf(2)
		})
	})
})
