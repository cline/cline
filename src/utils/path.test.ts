// Using require for mocha to fix ESM import issue
const mocha = require("mocha")
const { describe, it } = mocha
import * as os from "os"
import * as path from "path"
import "should"
import { arePathsEqual, getReadablePath } from "./path"

/**
 * Path Utilities Tests
 * These tests verify path handling across different platforms.
 * When TEST_MODE=true, special paths are handled to ensure consistent results.
 */
describe("Path Utilities", () => {
	// OS-agnostic path handling tests
	describe("arePathsEqual", () => {
		it("should handle undefined paths", () => {
			arePathsEqual(undefined as any, undefined as any).should.be.true()
			arePathsEqual("/test", undefined as any).should.be.false()
			arePathsEqual(undefined as any, "/test").should.be.false()
		})

		it("should handle case sensitivity based on platform", () => {
			const lowerPath = "/test/path"
			const upperPath = "/TEST/PATH"

			if (process.platform === "win32") {
				arePathsEqual(lowerPath, upperPath).should.be.true()
			} else {
				arePathsEqual(lowerPath, upperPath).should.be.false()
			}
		})

		it("should handle normalized paths", () => {
			arePathsEqual("/test/path/../", "/test").should.be.true()
			arePathsEqual("/test/path/..", "/test").should.be.true()
		})
	})

	describe("getReadablePath", () => {
		before(() => {
			// Log the test environment for debugging
			console.log(`TEST_MODE: ${process.env.TEST_MODE || "not set"}`)
			console.log(`Platform: ${process.platform}`)
		})

		// Use fixed test paths that don't depend on the OS
		const desktop = path.join(os.homedir(), "Desktop")
		const testPath = path.join(desktop, "test.txt")

		it("should handle desktop path", () => {
			// Force forward slashes for consistent testing
			getReadablePath(desktop, "test.txt").should.equal(testPath.replace(/\\/g, "/"))
		})

		// These tests depend on TEST_MODE=true for consistent cross-platform behavior
		it("should show relative paths within cwd", function () {
			const cwd = "/home/user/project"
			const filePath = path.join(cwd, "src/file.txt").replace(/\\/g, "/")
			const result = getReadablePath(cwd, "src/file.txt")
			console.log("Test case 1 - Expected: 'src/file.txt', Got:", result)
			result.should.equal("src/file.txt")
		})

		it("should show basename when path equals cwd", function () {
			const cwd = "/home/user/project"
			const result = getReadablePath(cwd, cwd)
			console.log("Test case 2 - Expected: 'project', Got:", result)
			result.should.equal("project")
		})

		it("should show absolute path when outside cwd", () => {
			const cwd = "/home/user/project"
			const filePath = "/home/user/other/file.txt"
			const result = getReadablePath(cwd, filePath)
			console.log("Test case 3 - Expected:", filePath, "Got:", result)
			result.should.equal(filePath)
		})
	})
})
