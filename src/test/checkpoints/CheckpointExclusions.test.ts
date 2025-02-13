import { describe, it, after, beforeEach } from "mocha"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { expect } from "chai"
import {
	getDefaultExclusions,
	getLfsPatterns,
	shouldExcludeFile,
	writeExcludesFile,
} from "../../integrations/checkpoints/CheckpointExclusions"
import { GIT_DISABLED_SUFFIX } from "../../integrations/checkpoints/CheckpointTracker"
import { fileExistsAtPath } from "../../utils/fs"

describe("CheckpointExclusions", () => {
	describe("getDefaultExclusions", () => {
		it("should return an array of categorized exclusion patterns", () => {
			const exclusions = getDefaultExclusions()

			// Verify return type and basic structure
			expect(exclusions).to.be.an("array")
			expect(exclusions.length).to.be.greaterThan(0)
			expect(exclusions.every((item: string) => typeof item === "string")).to.be.true

			// Verify build artifacts
			expect(exclusions).to.include(".git/")
			expect(exclusions).to.include("node_modules/")
			expect(exclusions).to.include("dist/")
			expect(exclusions).to.include("coverage/")

			// Verify media files
			expect(exclusions).to.include("*.jpg")
			expect(exclusions).to.include("*.mp4")
			expect(exclusions).to.include("*.png")

			// Verify cache files
			expect(exclusions).to.include("*.cache")
			expect(exclusions).to.include("*.tmp")

			// Verify config files
			expect(exclusions).to.include("*.env*")

			// Verify large data files
			expect(exclusions).to.include("*.zip")
			expect(exclusions).to.include("*.iso")

			// Verify database files
			expect(exclusions).to.include("*.sqlite")
			expect(exclusions).to.include("*.db")

			// Verify log files
			expect(exclusions).to.include("*.log")
			expect(exclusions).to.include("*.logs")

			// Verify pattern formats are maintained
			const directories = exclusions.filter((pattern: string) => pattern.endsWith("/"))
			const extensions = exclusions.filter((pattern: string) => pattern.startsWith("*."))
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

			// Verify cache initialization
			const excludePath = path.join(gitPath, "info", "exclude")
			const content = await fs.readFile(excludePath, "utf8")
			const patterns = content.split("\n")
			expect(patterns).to.include("*.custom")
			expect(patterns.length).to.be.greaterThan(0)
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

		it("should exclude files over size limit", async () => {
			const largePath = path.join(tmpDir, "large-file.txt")
			// Create a 6MB file using a string
			const content = "x".repeat(6 * 1024 * 1024)
			await fs.writeFile(largePath, content)

			const result = await shouldExcludeFile(largePath)
			expect(result.excluded).to.be.true
			expect(result.reason).to.match(/File size \d+\.\d+MB exceeds 5MB limit/)
		})

		it("should not exclude files under size limit", async () => {
			const smallPath = path.join(tmpDir, "small-file.txt")
			// Create a 4MB file
			const content = "x".repeat(4 * 1024 * 1024)
			await fs.writeFile(smallPath, content)

			const result = await shouldExcludeFile(smallPath)
			expect(result.excluded).to.be.false
			expect(result.reason).to.be.undefined
		})

		it("should handle filesystem errors gracefully", async () => {
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
