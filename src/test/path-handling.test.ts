import { describe, it } from "mocha"
import * as fs from "fs"
import * as path from "path"
// Using require for chai to fix ESM import issue
const chai = require("chai")
const { expect } = chai
import * as vscode from "vscode"
import { getShell } from "../utils/shell"
import { arePathsEqual } from "../utils/path"

// Create our own safeDirname function that was previously in global-path
function safeDirname(p?: string): string {
	// Use the current file's directory if no path is provided
	const dirPath = p || __dirname
	// Ensure the path is resolved correctly
	return path.resolve(dirPath)
}

describe("Path handling with spaces", () => {
	it("should correctly handle paths with spaces in temporary directory operations", async () => {
		// Create a temporary directory with spaces in the name
		const tempDirWithSpaces = path.join(safeDirname(), "..", "..", "temp test dir")

		try {
			// Create directory if it doesn't exist
			if (!fs.existsSync(tempDirWithSpaces)) {
				fs.mkdirSync(tempDirWithSpaces, { recursive: true })
			}

			// Create a test file in the directory with spaces
			const testFilePath = path.join(tempDirWithSpaces, "test file.txt")
			fs.writeFileSync(testFilePath, "test content")

			// Verify we can read from this path
			const content = fs.readFileSync(testFilePath, "utf8")
			expect(content).to.equal("test content")

			// Verify shell detection works even with spaces in paths
			const shell = getShell()
			expect(shell).to.be.a("string")
			expect(shell.length).to.be.greaterThan(0)
		} finally {
			// Clean up the test directory
			if (fs.existsSync(tempDirWithSpaces)) {
				fs.rmSync(tempDirWithSpaces, { recursive: true, force: true })
			}
		}
	})

	// Test specifically for handling package.json paths with spaces
	it("should correctly read package.json when path has spaces", async () => {
		const packagePath = path.join(safeDirname(), "..", "..", "package.json")

		// Read with path.join which properly handles spaces
		const content = await fs.promises.readFile(packagePath, "utf8")
		const packageJSON = JSON.parse(content)

		// Verify we can read even with spaces in the path
		expect(packageJSON).to.have.property("name")
		expect(packageJSON).to.have.property("version")
	})

	// Add a test specifically for safeDirname
	it("should verify safeDirname handles paths with spaces", () => {
		const regularDirname = __dirname
		const safeDirnameResult = safeDirname()

		// Both should resolve to the same location
		expect(path.resolve(regularDirname)).to.equal(safeDirnameResult)

		// Explicit test with spaces
		const pathWithSpaces = "C:\\Test Path With Spaces\\directory"
		expect(safeDirname(pathWithSpaces)).to.equal(path.resolve(pathWithSpaces))
	})

	// Test for arePathsEqual function
	it("should correctly compare paths using arePathsEqual", () => {
		const path1 = "C:\\Users\\test\\Documents"
		const path2 = "C:/Users/test/Documents"

		// These should be equal since the function normalizes path separators
		expect(arePathsEqual(path1, path2)).to.be.true

		// Test case sensitivity on Windows vs non-Windows
		const path3 = "C:\\Users\\Test\\Documents"
		if (process.platform === "win32") {
			expect(arePathsEqual(path1, path3)).to.be.true
		} else {
			expect(arePathsEqual(path1, path3)).to.be.false
		}
	})
})
