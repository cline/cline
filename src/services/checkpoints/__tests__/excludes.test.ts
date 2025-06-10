// npx jest src/services/checkpoints/__tests__/excludes.test.ts

import fs from "fs/promises"
import { join } from "path"

import { fileExistsAtPath } from "../../../utils/fs"

import { getExcludePatterns } from "../excludes"

jest.mock("fs/promises")

jest.mock("../../../utils/fs")

describe("getExcludePatterns", () => {
	const mockedFs = fs as jest.Mocked<typeof fs>
	const mockedFileExistsAtPath = fileExistsAtPath as jest.MockedFunction<typeof fileExistsAtPath>
	const testWorkspacePath = "/test/workspace"

	beforeEach(() => {
		jest.resetAllMocks()
	})

	describe("getLfsPatterns", () => {
		it("should include LFS patterns from .gitattributes when they exist", async () => {
			// Mock .gitattributes file exists
			mockedFileExistsAtPath.mockResolvedValue(true)

			// Mock .gitattributes file content with LFS patterns
			const gitAttributesContent = `*.psd filter=lfs diff=lfs merge=lfs -text
*.zip filter=lfs diff=lfs merge=lfs -text
# A comment line
*.mp4 filter=lfs diff=lfs merge=lfs -text
readme.md text
`
			mockedFs.readFile.mockResolvedValue(gitAttributesContent)

			// Expected LFS patterns
			const expectedLfsPatterns = ["*.psd", "*.zip", "*.mp4"]

			// Get exclude patterns
			const excludePatterns = await getExcludePatterns(testWorkspacePath)

			// Verify .gitattributes was checked at the correct path
			expect(mockedFileExistsAtPath).toHaveBeenCalledWith(join(testWorkspacePath, ".gitattributes"))

			// Verify file was read
			expect(mockedFs.readFile).toHaveBeenCalledWith(join(testWorkspacePath, ".gitattributes"), "utf8")

			// Verify LFS patterns are included in result
			expectedLfsPatterns.forEach((pattern) => {
				expect(excludePatterns).toContain(pattern)
			})

			// Verify all normal patterns also exist
			expect(excludePatterns).toContain(".git/")
		})

		it("should handle .gitattributes with no LFS patterns", async () => {
			// Mock .gitattributes file exists
			mockedFileExistsAtPath.mockResolvedValue(true)

			// Mock .gitattributes file content with no LFS patterns
			const gitAttributesContent = `*.md text
*.txt text
*.js text eol=lf
`
			mockedFs.readFile.mockResolvedValue(gitAttributesContent)

			// Get exclude patterns
			const excludePatterns = await getExcludePatterns(testWorkspacePath)

			// Verify .gitattributes was checked
			expect(mockedFileExistsAtPath).toHaveBeenCalledWith(join(testWorkspacePath, ".gitattributes"))

			// Verify file was read
			expect(mockedFs.readFile).toHaveBeenCalledWith(join(testWorkspacePath, ".gitattributes"), "utf8")

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
			mockedFileExistsAtPath.mockResolvedValue(false)

			// Get exclude patterns
			const excludePatterns = await getExcludePatterns(testWorkspacePath)

			// Verify .gitattributes was checked
			expect(mockedFileExistsAtPath).toHaveBeenCalledWith(join(testWorkspacePath, ".gitattributes"))

			// Verify file was not read
			expect(mockedFs.readFile).not.toHaveBeenCalled()

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
			mockedFileExistsAtPath.mockResolvedValue(true)

			// Mock readFile to throw error
			mockedFs.readFile.mockRejectedValue(new Error("File read error"))

			// Get exclude patterns
			const excludePatterns = await getExcludePatterns(testWorkspacePath)

			// Verify .gitattributes was checked
			expect(mockedFileExistsAtPath).toHaveBeenCalledWith(join(testWorkspacePath, ".gitattributes"))

			// Verify file read was attempted
			expect(mockedFs.readFile).toHaveBeenCalledWith(join(testWorkspacePath, ".gitattributes"), "utf8")

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
