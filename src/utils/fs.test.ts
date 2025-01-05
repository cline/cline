import { describe, it, expect,beforeEach } from "vitest"
import { createDirectoriesForFile, fileExistsAtPath } from "./fs"
import { vol, DirectoryJSON } from "memfs"
import path from "path"

describe("fs utilities", () => {
	beforeEach(() => {
		vol.reset()
	})

	describe("createDirectoriesForFile", () => {
		it("should create directories for a non-existing file path", async () => {
			const filePath = "/path/to/new/file.txt"
			const newDirectories = await createDirectoriesForFile(filePath)
			expect(newDirectories).toEqual(
				path.posix
					.dirname(filePath)
					.split(path.posix.sep)
					.filter((dir) => dir !== ""),
			)
			expect(vol.existsSync("/path/to/new")).toBe(true)
		})

		it("should not create directories if the path already exists", async () => {
			vol.fromJSON({
				"/path": null,
				"/path/to": null,
				"/path/to/existing": null,
			} as DirectoryJSON)
			const filePath = "/path/to/existing/file.txt"
			const newDirectories = await createDirectoriesForFile(filePath)
			expect(newDirectories).toEqual([])
			expect(vol.existsSync("/path/to/existing")).toBe(true)
		})

		it("should handle nested directories correctly", async () => {
			const filePath = "/nested/path/to/new/file.txt"
			const newDirectories = await createDirectoriesForFile(filePath)
			expect(newDirectories).toEqual(
				path.posix
					.dirname(filePath)
					.split(path.posix.sep)
					.filter((dir) => dir !== ""),
			)
			expect(vol.existsSync("/nested/path/to/new")).toBe(true)
		})
	})

	describe("fileExistsAtPath", () => {
		it("should return true if the file exists", async () => {
			console.debug("Running test: should return true if the file exists")
			const filePath = "/existing/file.txt"
			const fileContent = "content"
			vol.fromJSON({ [filePath]: fileContent } as DirectoryJSON)
			console.debug(`Setting up file at path: ${filePath} with content: ${fileContent}`)
			const exists = await fileExistsAtPath(filePath)
			console.debug(`Actual result: ${exists}`)
			expect(exists).toBe(true)
		})

		it("should return false if the file does not exist", async () => {
			const exists = await fileExistsAtPath("/non-existing/file.txt")
			expect(exists).toBe(false)
		})
	})
})
