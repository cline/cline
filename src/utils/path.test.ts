import * as assert from "assert"
import * as path from "path"
import * as os from "os"
import { arePathsEqual, getReadablePath } from "./path"

suite("Path Utils", () => {
	test("arePathsEqual handles undefined paths", () => {
		assert.strictEqual(arePathsEqual(undefined, undefined), true)
		assert.strictEqual(arePathsEqual("foo", undefined), false)
		assert.strictEqual(arePathsEqual(undefined, "foo"), false)
	})

	test("arePathsEqual handles case sensitivity based on platform", () => {
		if (process.platform === "win32") {
			assert.strictEqual(arePathsEqual("FOO/BAR", "foo/bar"), true)
		} else {
			assert.strictEqual(arePathsEqual("FOO/BAR", "foo/bar"), false)
		}
	})

	test("arePathsEqual handles normalized paths", () => {
		assert.strictEqual(arePathsEqual("/tmp/./dir", "/tmp/../tmp/dir"), true)
		assert.strictEqual(arePathsEqual("/tmp/./dir", "/tmp/../dir"), false)
	})

	test("getReadablePath handles desktop path", () => {
		const desktop = path.join(os.homedir(), "Desktop")
		const testPath = path.join(desktop, "test.txt")
		assert.strictEqual(getReadablePath(desktop, "test.txt"), testPath.replace(/\\/g, "/"))
	})

	test("getReadablePath shows relative paths within cwd", () => {
		const cwd = "/home/user/project"
		const filePath = "/home/user/project/src/file.txt"
		assert.strictEqual(getReadablePath(cwd, filePath), "src/file.txt")
	})

	test("getReadablePath shows basename when path equals cwd", () => {
		const cwd = "/home/user/project"
		assert.strictEqual(getReadablePath(cwd, cwd), "project")
	})

	test("getReadablePath shows absolute path when outside cwd", () => {
		const cwd = "/home/user/project"
		const filePath = "/home/user/other/file.txt"
		assert.strictEqual(getReadablePath(cwd, filePath), filePath)
	})
})
