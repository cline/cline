import { vi, describe, it, expect, beforeEach } from "vitest"
import * as path from "path"
import { listFiles } from "../list-files"
import * as childProcess from "child_process"

vi.mock("../list-files", async () => {
	const actual = await vi.importActual("../list-files")
	return {
		...actual,
		handleSpecialDirectories: vi.fn(),
	}
})

describe("listFiles", () => {
	it("should return empty array immediately when limit is 0", async () => {
		const result = await listFiles("/test/path", true, 0)

		expect(result).toEqual([[], false])
	})
})

// Mock ripgrep to avoid filesystem dependencies
vi.mock("../../ripgrep", () => ({
	getBinPath: vi.fn().mockResolvedValue("/mock/path/to/rg"),
}))

// Mock vscode
vi.mock("vscode", () => ({
	env: {
		appRoot: "/mock/app/root",
	},
}))

// Mock filesystem operations
vi.mock("fs", () => ({
	promises: {
		access: vi.fn().mockRejectedValue(new Error("Not found")),
		readFile: vi.fn().mockResolvedValue(""),
		readdir: vi.fn().mockResolvedValue([]),
	},
}))

// Import fs to set up mocks
import * as fs from "fs"

vi.mock("child_process", () => ({
	spawn: vi.fn(),
}))

vi.mock("../../path", () => ({
	arePathsEqual: vi.fn().mockReturnValue(false),
}))

describe("list-files symlink support", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("should include --follow flag in ripgrep arguments", async () => {
		const mockSpawn = vi.mocked(childProcess.spawn)
		const mockProcess = {
			stdout: {
				on: vi.fn((event, callback) => {
					if (event === "data") {
						// Simulate some output to complete the process
						setTimeout(() => callback("test-file.txt\n"), 10)
					}
				}),
			},
			stderr: {
				on: vi.fn(),
			},
			on: vi.fn((event, callback) => {
				if (event === "close") {
					setTimeout(() => callback(0), 20)
				}
				if (event === "error") {
					// No error simulation
				}
			}),
			kill: vi.fn(),
		}

		mockSpawn.mockReturnValue(mockProcess as any)

		// Call listFiles to trigger ripgrep execution
		await listFiles("/test/dir", false, 100)

		// Verify that spawn was called with --follow flag (the critical fix)
		const [rgPath, args] = mockSpawn.mock.calls[0]
		expect(rgPath).toBe("/mock/path/to/rg")
		expect(args).toContain("--files")
		expect(args).toContain("--hidden")
		expect(args).toContain("--follow") // This is the critical assertion - the fix should add this flag

		// Platform-agnostic path check - verify the last argument is the resolved path
		const expectedPath = path.resolve("/test/dir")
		expect(args[args.length - 1]).toBe(expectedPath)
	})

	it("should include --follow flag for recursive listings too", async () => {
		const mockSpawn = vi.mocked(childProcess.spawn)
		const mockProcess = {
			stdout: {
				on: vi.fn((event, callback) => {
					if (event === "data") {
						setTimeout(() => callback("test-file.txt\n"), 10)
					}
				}),
			},
			stderr: {
				on: vi.fn(),
			},
			on: vi.fn((event, callback) => {
				if (event === "close") {
					setTimeout(() => callback(0), 20)
				}
				if (event === "error") {
					// No error simulation
				}
			}),
			kill: vi.fn(),
		}

		mockSpawn.mockReturnValue(mockProcess as any)

		// Call listFiles with recursive=true
		await listFiles("/test/dir", true, 100)

		// Verify that spawn was called with --follow flag (the critical fix)
		const [rgPath, args] = mockSpawn.mock.calls[0]
		expect(rgPath).toBe("/mock/path/to/rg")
		expect(args).toContain("--files")
		expect(args).toContain("--hidden")
		expect(args).toContain("--follow") // This should be present in recursive mode too

		// Platform-agnostic path check - verify the last argument is the resolved path
		const expectedPath = path.resolve("/test/dir")
		expect(args[args.length - 1]).toBe(expectedPath)
	})

	it("should ensure first-level directories are included when limit is reached", async () => {
		// Mock fs.promises.readdir to simulate a directory structure
		const mockReaddir = vi.mocked(fs.promises.readdir)

		// Root directory with first-level directories
		mockReaddir.mockResolvedValueOnce([
			{ name: "a_dir", isDirectory: () => true, isSymbolicLink: () => false, isFile: () => false } as any,
			{ name: "b_dir", isDirectory: () => true, isSymbolicLink: () => false, isFile: () => false } as any,
			{ name: "c_dir", isDirectory: () => true, isSymbolicLink: () => false, isFile: () => false } as any,
			{ name: "file1.txt", isDirectory: () => false, isSymbolicLink: () => false, isFile: () => true } as any,
			{ name: "file2.txt", isDirectory: () => false, isSymbolicLink: () => false, isFile: () => true } as any,
		])

		// Mock ripgrep to return many files (simulating hitting the limit)
		const mockSpawn = vi.mocked(childProcess.spawn)
		const mockProcess = {
			stdout: {
				on: vi.fn((event, callback) => {
					if (event === "data") {
						// Return many file paths to trigger the limit
						const paths =
							[
								"/test/dir/a_dir/",
								"/test/dir/a_dir/subdir1/",
								"/test/dir/a_dir/subdir1/file1.txt",
								"/test/dir/a_dir/subdir1/file2.txt",
								"/test/dir/a_dir/subdir2/",
								"/test/dir/a_dir/subdir2/file3.txt",
								"/test/dir/a_dir/file4.txt",
								"/test/dir/a_dir/file5.txt",
								"/test/dir/file1.txt",
								"/test/dir/file2.txt",
								// Note: b_dir and c_dir are missing from ripgrep output
							].join("\n") + "\n"
						setTimeout(() => callback(paths), 10)
					}
				}),
			},
			stderr: {
				on: vi.fn(),
			},
			on: vi.fn((event, callback) => {
				if (event === "close") {
					setTimeout(() => callback(0), 20)
				}
			}),
			kill: vi.fn(),
		}
		mockSpawn.mockReturnValue(mockProcess as any)

		// Mock fs.promises.access to simulate .gitignore doesn't exist
		vi.mocked(fs.promises.access).mockRejectedValue(new Error("File not found"))

		// Call listFiles with recursive=true and a small limit
		const [results, limitReached] = await listFiles("/test/dir", true, 10)

		// Verify that we got results and hit the limit
		expect(results.length).toBe(10)
		expect(limitReached).toBe(true)

		// Count directories in results
		const directories = results.filter((r) => r.endsWith("/"))

		// We should have at least the 3 first-level directories
		// even if ripgrep didn't return all of them
		expect(directories.length).toBeGreaterThanOrEqual(3)

		// Verify all first-level directories are included
		const hasADir = results.some((r) => r.endsWith("a_dir/"))
		const hasBDir = results.some((r) => r.endsWith("b_dir/"))
		const hasCDir = results.some((r) => r.endsWith("c_dir/"))

		expect(hasADir).toBe(true)
		expect(hasBDir).toBe(true)
		expect(hasCDir).toBe(true)
	})
})
