import * as fs from "fs/promises"
import { afterEach, beforeEach, describe, test, expect, vi } from "vitest"
import * as os from "os"
import * as path from "path"
import { createDirectoriesForFile, fileExistsAtPath } from "./fs"

vi.mock("fs/promises", () => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  rm: vi.fn(),
  access: vi.fn().mockImplementation((path) => {
    if (path.includes("existing")) {
      return Promise.resolve();
    }
    return Promise.reject(new Error("File not found"));
  }),
}));

describe("Filesystem Utilities", () => {
  const tmpDir = path.join(os.tmpdir(), "cline-test-" + Math.random().toString(36).slice(2))

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe("fileExistsAtPath", () => {
    test("should return true for existing paths", async () => {
      const testFile = path.join(tmpDir, "test.txt")
      vi.mocked(fs.access).mockResolvedValueOnce(undefined);

      const exists = await fileExistsAtPath(testFile)
      expect(exists).toBe(true)
      expect(fs.access).toHaveBeenCalledWith(testFile)
    })

    test("should return false for non-existing paths", async () => {
      const nonExistentPath = path.join(tmpDir, "does-not-exist.txt")
      vi.mocked(fs.access).mockRejectedValueOnce(new Error("File not found"));

      const exists = await fileExistsAtPath(nonExistentPath)
      expect(exists).toBe(false)
      expect(fs.access).toHaveBeenCalledWith(nonExistentPath)
    })
  })

  describe("createDirectoriesForFile", () => {
    test("should create all necessary directories", async () => {
      const deepPath = path.join(tmpDir, "deep", "nested", "dir", "file.txt")
      vi.mocked(fs.mkdir).mockResolvedValueOnce(undefined);

      const createdDirs = await createDirectoriesForFile(deepPath)
      expect(createdDirs.length).toBeGreaterThan(0)
      expect(fs.mkdir).toHaveBeenCalledWith(path.dirname(deepPath), { recursive: true })
    })

    test("should handle existing directories", async () => {
      const existingDir = path.join(tmpDir, "existing")
      const filePath = path.join(existingDir, "file.txt")
      vi.mocked(fs.access).mockResolvedValueOnce(undefined);

      const createdDirs = await createDirectoriesForFile(filePath)
      expect(createdDirs.length).toBe(0)
      expect(fs.mkdir).not.toHaveBeenCalled()
    })

    test("should normalize paths", async () => {
      const unnormalizedPath = path.join(tmpDir, "a", "..", "b", ".", "file.txt")
      const normalizedPath = path.join(tmpDir, "b", "file.txt")
      vi.mocked(fs.mkdir).mockResolvedValueOnce(undefined);

      const createdDirs = await createDirectoriesForFile(unnormalizedPath)
      expect(createdDirs.length).toBe(1)
      expect(fs.mkdir).toHaveBeenCalledWith(path.dirname(normalizedPath), { recursive: true })
    })
  })
})
