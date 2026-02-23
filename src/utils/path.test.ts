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

		it("should not confuse similar path prefixes (bug #8761)", () => {
			// Regression test for: /home/user/project should NOT match /home/user/project-backup
			const cwd = path.resolve("/home/user/project")
			const similarPath = path.resolve("/home/user/project-backup/src/file.txt")
			// project-backup is NOT inside project, so should return absolute path
			getReadablePath(cwd, similarPath).should.equal(similarPath.toPosix())
		})
	})

	describe("isLocatedInPath", () => {
		it("should return true for paths inside directory", () => {
			isLocatedInPath("/home/user/project", "/home/user/project/src/file.txt").should.be.true()
		})

		it("should return false for paths outside directory", () => {
			isLocatedInPath("/home/user/project", "/home/user/other/file.txt").should.be.false()
		})

		it("should return false for similar path prefixes (bug #8761)", () => {
			// /home/user/project should NOT match /home/user/project-backup
			isLocatedInPath("/home/user/project", "/home/user/project-backup/file.txt").should.be.false()
			isLocatedInPath("/home/user/project", "/home/user/project-backup/src/file.txt").should.be.false()
		})

		it("should handle empty paths", () => {
			isLocatedInPath("", "/some/path").should.be.false()
			isLocatedInPath("/some/path", "").should.be.false()
		})
	})
})
