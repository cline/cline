import { describe, test, expect } from "vitest"
import * as os from "os"
import * as path from "path"
import { arePathsEqual, getReadablePath } from "./path"

describe("Path Utilities", () => {
  describe("arePathsEqual", () => {
    test("should handle undefined paths", () => {
      expect(arePathsEqual(undefined, undefined)).toBe(true)
      expect(arePathsEqual("foo", undefined)).toBe(false)
      expect(arePathsEqual(undefined, "foo")).toBe(false)
    })

    test("should handle case sensitivity based on platform", () => {
      if (process.platform === "win32") {
        expect(arePathsEqual("FOO/BAR", "foo/bar")).toBe(true)
      } else {
        expect(arePathsEqual("FOO/BAR", "foo/bar")).toBe(false)
      }
    })

    test("should handle normalized paths", () => {
      expect(arePathsEqual("/tmp/./dir", "/tmp/../tmp/dir")).toBe(true)
      expect(arePathsEqual("/tmp/./dir", "/tmp/../dir")).toBe(false)
    })
  })

  describe("getReadablePath", () => {
    test("should handle desktop path", () => {
      const desktop = path.join(os.homedir(), "Desktop")
      const testPath = path.join(desktop, "test.txt")
      expect(getReadablePath(desktop, "test.txt")).toEqual(testPath.replace(/\\/g, "/"))
    })

    test("should show relative paths within cwd", () => {
      const cwd = "/home/user/project"
      const filePath = "/home/user/project/src/file.txt"
      expect(getReadablePath(cwd, filePath)).toEqual("src/file.txt")
    })

    test("should show basename when path equals cwd", () => {
      const cwd = process.platform === "win32" ? "C:\\home\\user\\project" : "/home/user/project"
      expect(getReadablePath(cwd, cwd)).toEqual("project")
    })

    test("should show absolute path when outside cwd", () => {
      const cwd = process.platform === "win32" ? "C:\\home\\user\\project" : "/home/user/project"
      const filePath = process.platform === "win32" ? "C:\\home\\user\\other\\file.txt" : "/home/user/other/file.txt"
      const expected = process.platform === "win32" ? "C:/home/user/other/file.txt" : "/home/user/other/file.txt"
      expect(getReadablePath(cwd, filePath)).toEqual(expected)
    })
  })
})
