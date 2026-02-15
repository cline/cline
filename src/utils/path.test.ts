import { describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import "should"
import { arePathsEqual, getReadablePath, isLocatedInPath } from "./path"

describe("Path Utilities", () => {
	describe("arePathsEqual", () => {
		it("should handle undefined paths", () => {
			arePathsEqual(undefined, undefined).should.be.true()
			arePathsEqual("foo", undefined).should.be.false()
			arePathsEqual(undefined, "foo").should.be.false()
		})

		it("should handle case sensitivity based on platform", () => {
			if (process.platform === "win32") {
				arePathsEqual("FOO/BAR", "foo/bar").should.be.true()
			} else {
				arePathsEqual("FOO/BAR", "foo/bar").should.be.false()
			}
		})

		it("should handle normalized paths", () => {
			arePathsEqual("/tmp/./dir", "/tmp/../tmp/dir").should.be.true()
			arePathsEqual("/tmp/./dir", "/tmp/../dir").should.be.false()
		})
	})

	describe("getReadablePath", () => {
		it("should handle desktop path", () => {
			const desktop = path.join(os.homedir(), "Desktop")
			const testPath = path.join(desktop, "test.txt")
			getReadablePath(desktop, "test.txt").should.equal(testPath.replace(/\\/g, "/"))
		})

		it("should show relative paths within cwd", () => {
			const cwd = path.resolve("/home/user/project")
			const filePath = path.resolve("/home/user/project/src/file.txt")
			getReadablePath(cwd, filePath).should.equal("src/file.txt")
		})

		it("should show basename when path equals cwd", () => {
			const cwd = path.resolve("/home/user/project")
			getReadablePath(cwd, cwd).should.equal("project")
		})

		it("should show absolute path when outside cwd", () => {
			const cwd = path.resolve("/home/user/project")
			const filePath = path.resolve("/home/user/other/file.txt")
			getReadablePath(cwd, filePath).should.equal(filePath.toPosix())
		})

		it("should not treat project-backup as inside project", () => {
			const base = path.join(os.tmpdir(), "cline-path-tests")
			const cwd = path.join(base, "project")
			const filePath = path.join(base, "project-backup", "src", "file.txt")
			getReadablePath(cwd, filePath).should.equal(filePath.toPosix())
		})

		it("should not treat project2 as inside project", () => {
			const base = path.join(os.tmpdir(), "cline-path-tests")
			const cwd = path.join(base, "project")
			const filePath = path.join(base, "project2", "src", "file.txt")
			getReadablePath(cwd, filePath).should.equal(filePath.toPosix())
		})
	})

	describe("isLocatedInPath", () => {
		it("should treat windows extended-length paths as boundary-aware", () => {
			const dirPath = "\\\\?\\C:\\Users\\user\\project"
			const insidePath = "\\\\?\\C:\\Users\\user\\project\\src\\file.ts"
			const prefixCollisionPath = "\\\\?\\C:\\Users\\user\\project-backup\\src\\file.ts"

			isLocatedInPath(dirPath, insidePath).should.be.true()
			isLocatedInPath(dirPath, prefixCollisionPath).should.be.false()
		})

		it("should compare windows extended-length paths case-insensitively", () => {
			const dirPath = "\\\\?\\C:\\Users\\User\\Project"
			const insidePath = "\\\\?\\c:\\users\\user\\project\\src\\file.ts"

			isLocatedInPath(dirPath, insidePath).should.be.true()
		})

		it("should handle mixed extended and non-extended windows paths", () => {
			const dirPath = "\\\\?\\C:\\Users\\user\\project"
			const insidePath = "C:\\Users\\user\\project\\src\\file.ts"

			isLocatedInPath(dirPath, insidePath).should.be.true()
		})

		it("should preserve case sensitivity for non-windows-style extended paths", () => {
			const dirPath = "\\\\?\\tmp\\Project"
			const insidePath = "\\\\?\\tmp\\project\\src\\file.ts"

			isLocatedInPath(dirPath, insidePath).should.be.false()
		})
	})
})
