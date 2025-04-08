import { describe, it, expect } from "vitest"
import * as os from "os"
import * as path from "path"
import { arePathsEqual, getReadablePath } from "../path"

describe("Path Utilities", () => {
	describe("arePathsEqual", () => {
		it("should handle undefined paths", () => {
			expect(arePathsEqual(undefined, undefined)).toBe(true)
			expect(arePathsEqual("foo", undefined)).toBe(false)
			expect(arePathsEqual(undefined, "foo")).toBe(false)
		})

		it("should handle case sensitivity based on platform", () => {
			if (process.platform === "win32") {
				expect(arePathsEqual("FOO/BAR", "foo/bar")).toBe(true)
			} else {
				expect(arePathsEqual("FOO/BAR", "foo/bar")).toBe(false)
			}
		})

		it("should handle normalized paths", () => {
			expect(arePathsEqual("/tmp/./dir", "/tmp/../tmp/dir")).toBe(true)
			expect(arePathsEqual("/tmp/./dir", "/tmp/../dir")).toBe(false)
		})
	})

	describe("getReadablePath", () => {
		it("should handle desktop path", () => {
			const desktop = path.join(os.homedir(), "Desktop")
			const testPath = path.join(desktop, "test.txt")
			expect(getReadablePath(desktop, "test.txt")).toBe(testPath.replace(/\\/g, "/"))
		})

		it("should show relative paths within cwd", () => {
			const cwd = "/home/user/project"
			const filePath = "/home/user/project/src/file.txt"
			expect(getReadablePath(cwd, filePath)).toBe("src/file.txt")
		})

		it("should show basename when path equals cwd", () => {
			const cwd = "/home/user/project"
			expect(getReadablePath(cwd, cwd)).toBe("project")
		})

		it("should show absolute path when outside cwd", () => {
			const cwd = "/home/user/project"
			const filePath = "/home/user/other/file.txt"
			expect(getReadablePath(cwd, filePath)).toBe(filePath)
		})
	})
})
