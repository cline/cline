import { describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import "should"
import { arePathsEqual, getReadablePath } from "./path"

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
	})
})
