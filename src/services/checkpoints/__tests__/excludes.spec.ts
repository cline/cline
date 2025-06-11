// npx vitest services/checkpoints/__tests__/excludes.spec.ts

import { vi, describe, it, expect, beforeEach } from "vitest"
import { join } from "path"
import fs from "fs/promises"
import { fileExistsAtPath } from "../../../utils/fs"
import { getExcludePatterns } from "../excludes"

// Mock fs/promises
vi.mock("fs/promises", () => ({
	default: {
		readFile: vi.fn(),
	},
}))

// Mock fileExistsAtPath
vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn(),
}))

describe("getExcludePatterns", () => {
	const testWorkspacePath = "/test/workspace"

	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("getLfsPatterns", () => {
		it("should include LFS patterns from .gitattributes when they exist", async () => {
			// Mock .gitattributes file exists
			vi.mocked(fileExistsAtPath).mockResolvedValue(true)

			// Mock .gitattributes file content with LFS patterns
			const gitAttributesContent = `*.psd filter=lfs diff=lfs merge=lfs -text
*.zip filter=lfs diff=lfs merge=lfs -text
# A comment line
*.mp4 filter=lfs diff=lfs merge=lfs -text
readme.md text
`
			vi.mocked(fs.readFile).mockResolvedValue(gitAttributesContent)

			// Expected LFS patterns
			const expectedLfsPatterns = ["*.psd", "*.zip", "*.mp4"]

			// Get exclude patterns
			const excludePatterns = await getExcludePatterns(testWorkspacePath)

			// Verify .gitattributes was checked at the correct path
			expect(fileExistsAtPath).toHaveBeenCalledWith(join(testWorkspacePath, ".gitattributes"))

			// Verify file was read
			expect(fs.readFile).toHaveBeenCalledWith(join(testWorkspacePath, ".gitattributes"), "utf8")

			// Verify LFS patterns are included in result
			expectedLfsPatterns.forEach((pattern) => {
				expect(excludePatterns).toContain(pattern)
			})

			// Verify all normal patterns also exist
			expect(excludePatterns).toContain(".git/")
		})

		it("should handle .gitattributes with no LFS patterns", async () => {
			// Mock .gitattributes file exists
			vi.mocked(fileExistsAtPath).mockResolvedValue(true)

			// Mock .gitattributes file content with no LFS patterns
			const gitAttributesContent = `*.md text
*.txt text
*.js text eol=lf
`
			vi.mocked(fs.readFile).mockResolvedValue(gitAttributesContent)

			// Get exclude patterns
			const excludePatterns = await getExcludePatterns(testWorkspacePath)

			// Verify .gitattributes was checked
			expect(fileExistsAtPath).toHaveBeenCalledWith(join(testWorkspacePath, ".gitattributes"))

			// Verify file was read
			expect(fs.readFile).toHaveBeenCalledWith(join(testWorkspacePath, ".gitattributes"), "utf8")

			// Verify LFS patterns are not included
			// Just ensure no lines from our mock gitAttributes are in the result
			const gitAttributesLines = gitAttributesContent.split("\n").map((line) => line.split(" ")[0].trim())

			gitAttributesLines.forEach((line) => {
				if (line && !line.startsWith("#")) {
					expect(excludePatterns.includes(line)).toBe(false)
				}
			})

			// Verify default patterns are included
			expect(excludePatterns).toContain(".git/")
		})

		it("should handle missing .gitattributes file", async () => {
			// Mock .gitattributes file doesn't exist
			vi.mocked(fileExistsAtPath).mockResolvedValue(false)

			// Get exclude patterns
			const excludePatterns = await getExcludePatterns(testWorkspacePath)

			// Verify .gitattributes was checked
			expect(fileExistsAtPath).toHaveBeenCalledWith(join(testWorkspacePath, ".gitattributes"))

			// Verify file was not read
			expect(fs.readFile).not.toHaveBeenCalled()

			// Verify standard patterns are included
			expect(excludePatterns).toContain(".git/")

			// Verify we have standard patterns but no LFS patterns
			// Check for a few known patterns from different categories
			expect(excludePatterns).toContain("node_modules/") // buildArtifact
			expect(excludePatterns).toContain("*.jpg") // media
			expect(excludePatterns).toContain("*.tmp") // cache
			expect(excludePatterns).toContain("*.env*") // config
			expect(excludePatterns).toContain("*.zip") // large data
			expect(excludePatterns).toContain("*.db") // database
			expect(excludePatterns).toContain("*.shp") // geospatial
			expect(excludePatterns).toContain("*.log") // log
		})

		it("should handle errors when reading .gitattributes", async () => {
			// Mock .gitattributes file exists
			vi.mocked(fileExistsAtPath).mockResolvedValue(true)

			// Mock readFile to throw error
			vi.mocked(fs.readFile).mockRejectedValue(new Error("File read error"))

			// Get exclude patterns
			const excludePatterns = await getExcludePatterns(testWorkspacePath)

			// Verify .gitattributes was checked
			expect(fileExistsAtPath).toHaveBeenCalledWith(join(testWorkspacePath, ".gitattributes"))

			// Verify file read was attempted
			expect(fs.readFile).toHaveBeenCalledWith(join(testWorkspacePath, ".gitattributes"), "utf8")

			// Verify standard patterns are included
			expect(excludePatterns).toContain(".git/")

			// Verify we have standard patterns but no LFS patterns
			// Check for a few known patterns from different categories
			expect(excludePatterns).toContain("node_modules/") // buildArtifact
			expect(excludePatterns).toContain("*.jpg") // media
			expect(excludePatterns).toContain("*.tmp") // cache
			expect(excludePatterns).toContain("*.env*") // config
			expect(excludePatterns).toContain("*.zip") // large data
			expect(excludePatterns).toContain("*.db") // database
			expect(excludePatterns).toContain("*.shp") // geospatial
			expect(excludePatterns).toContain("*.log") // log
		})
	})
})
