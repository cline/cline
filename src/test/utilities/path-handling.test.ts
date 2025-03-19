// @ts-nocheck
/**
 * Tests for path handling utilities.
 *
 * NOTE: We're using CommonJS-style imports for Mocha (require) due to VS Code's test runner
 * compatibility requirements. This is necessary because VS Code's test infrastructure
 * requires CommonJS modules even when using nodenext module resolution. The rest of the
 * codebase uses ESM imports, but tests need CommonJS for compatibility with VS Code testing.
 */
const mocha = require("mocha")
const { describe, it } = mocha
const fs = require("fs")
const path = require("path")
// Using require for chai to fix ESM import issue
const chai = require("chai")
const { expect } = chai
const vscode = require("vscode")
const { getShell } = require("../../utils/shell")
// Import the path utils
const { arePathsEqual, getReadablePath } = require("../../utils/path")

// Helper function for directory paths
function safeDirname(p?: string): string {
	// Use the current file's directory if no path is provided
	const dirPath = p || __dirname
	// Ensure the path is resolved correctly
	return path.resolve(dirPath)
}

describe("Path Handling Tests", () => {
	describe("arePathsEqual function", () => {
		it("should handle paths with different slashes", () => {
			const path1 = "C:/folder/file.txt"
			const path2 = "C:\\folder\\file.txt"
			expect(arePathsEqual(path1, path2)).to.be.true
		})

		it("should handle case sensitivity based on platform", () => {
			const path1 = "C:/Folder/file.txt"
			const path2 = "C:/folder/FILE.txt"

			// Windows is case-insensitive, other platforms are case-sensitive
			const isWindows = process.platform === "win32"
			expect(arePathsEqual(path1, path2)).to.equal(isWindows)
		})

		it("should handle undefined or empty paths", () => {
			expect(arePathsEqual("", "")).to.be.true
			expect(arePathsEqual(undefined, undefined)).to.be.true
			expect(arePathsEqual("", undefined)).to.be.false
			expect(arePathsEqual("/path", "")).to.be.false
		})
	})

	describe("getReadablePath function", () => {
		it("should normalize paths with forward slashes", () => {
			const winPath = "C:\\folder\\file.txt"
			expect(getReadablePath(winPath)).to.not.include("\\")
			expect(getReadablePath(winPath)).to.include("/")
		})

		it("should handle special test paths when TEST_MODE is set", () => {
			// This test depends on TEST_MODE being set
			process.env.TEST_MODE = "true"

			const testPath = "C:\\Code\\Project\\src\\test.js"
			const result = getReadablePath(testPath)

			// In TEST_MODE, this should convert to a normalized format
			expect(result).to.include("/")
			expect(result).to.not.include("\\")
		})
	})

	describe("Path handling with spaces", () => {
		it("should correctly handle paths with spaces", async () => {
			// Create a temporary directory with spaces in the name
			const tempDirWithSpaces = path.join(safeDirname(), "..", "..", "temp test dir")

			try {
				// Create directory if it doesn't exist
				if (!fs.existsSync(tempDirWithSpaces)) {
					fs.mkdirSync(tempDirWithSpaces, { recursive: true })
				}

				// Test that we can read from it
				expect(fs.existsSync(tempDirWithSpaces)).to.be.true

				// Create a temp file inside
				const testFilePath = path.join(tempDirWithSpaces, "test file.txt")
				fs.writeFileSync(testFilePath, "Test content")

				// Verify the file exists and has the content
				expect(fs.existsSync(testFilePath)).to.be.true
				expect(fs.readFileSync(testFilePath, "utf8")).to.equal("Test content")

				// Test path equality with spaces
				const pathWithDifferentSlashes = tempDirWithSpaces.replace(/\\/g, "/")
				expect(arePathsEqual(tempDirWithSpaces, pathWithDifferentSlashes)).to.be.true
			} finally {
				// Clean up the test directory and file
				try {
					const testFilePath = path.join(tempDirWithSpaces, "test file.txt")
					if (fs.existsSync(testFilePath)) {
						fs.unlinkSync(testFilePath)
					}
					if (fs.existsSync(tempDirWithSpaces)) {
						fs.rmdirSync(tempDirWithSpaces)
					}
				} catch (err) {
					console.error("Error cleaning up test files:", err)
				}
			}
		})
	})
})
