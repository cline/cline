import * as path from "path"
import * as childProcess from "child_process"
import { listFiles } from "../list-files"

vi.mock("child_process")
vi.mock("fs")
vi.mock("vscode", () => ({
	env: {
		appRoot: "/mock/vscode/app/root",
	},
}))

vi.mock("../../ripgrep", () => ({
	getBinPath: vi.fn().mockResolvedValue("/mock/path/to/rg"),
}))

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

		// Use a test directory path
		const testDir = "/test/dir"

		// Call listFiles to trigger ripgrep execution
		await listFiles(testDir, false, 100)

		// Verify that spawn was called with --follow flag (the critical fix)
		const [rgPath, args] = mockSpawn.mock.calls[0]
		expect(rgPath).toBe("/mock/path/to/rg")
		expect(args).toContain("--files")
		expect(args).toContain("--hidden")
		expect(args).toContain("--follow") // This is the critical assertion - the fix should add this flag

		// Platform-agnostic path check - verify the last argument ends with the expected path
		const lastArg = args[args.length - 1]
		// On Windows, the path might be resolved to something like D:\test\dir
		// On Unix, it would be /test/dir
		// So we just check that it ends with the expected segments
		expect(lastArg).toMatch(/[/\\]test[/\\]dir$/)
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

		// Use a test directory path
		const testDir = "/test/dir"

		// Call listFiles with recursive=true
		await listFiles(testDir, true, 100)

		// Verify that spawn was called with --follow flag (the critical fix)
		const [rgPath, args] = mockSpawn.mock.calls[0]
		expect(rgPath).toBe("/mock/path/to/rg")
		expect(args).toContain("--files")
		expect(args).toContain("--hidden")
		expect(args).toContain("--follow") // This should be present in recursive mode too

		// Platform-agnostic path check - verify the last argument ends with the expected path
		const lastArg = args[args.length - 1]
		// On Windows, the path might be resolved to something like D:\test\dir
		// On Unix, it would be /test/dir
		// So we just check that it ends with the expected segments
		expect(lastArg).toMatch(/[/\\]test[/\\]dir$/)
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
						// Note: ripgrep returns relative paths
						const paths =
							[
								"a_dir/",
								"a_dir/subdir1/",
								"a_dir/subdir1/file1.txt",
								"a_dir/subdir1/file2.txt",
								"a_dir/subdir2/",
								"a_dir/subdir2/file3.txt",
								"a_dir/file4.txt",
								"a_dir/file5.txt",
								"file1.txt",
								"file2.txt",
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

describe("hidden directory exclusion", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("should exclude .git subdirectories from recursive directory listing", async () => {
		// Mock filesystem structure with .git subdirectories
		const mockReaddir = vi.fn()
		vi.mocked(fs.promises).readdir = mockReaddir

		// Mock the directory structure:
		// /test/
		//   .git/
		//     hooks/
		//     objects/
		//   src/
		//     components/
		mockReaddir
			.mockResolvedValueOnce([
				{ name: ".git", isDirectory: () => true, isSymbolicLink: () => false },
				{ name: "src", isDirectory: () => true, isSymbolicLink: () => false },
			])
			.mockResolvedValueOnce([
				// src subdirectories (should be included)
				{ name: "components", isDirectory: () => true, isSymbolicLink: () => false },
			])
			.mockResolvedValueOnce([]) // components/ is empty

		// Mock ripgrep to return no files
		const mockSpawn = vi.mocked(childProcess.spawn)
		const mockProcess = {
			stdout: {
				on: vi.fn((event, callback) => {
					if (event === "data") {
						// No files returned
					}
				}),
			},
			stderr: {
				on: vi.fn(),
			},
			on: vi.fn((event, callback) => {
				if (event === "close") {
					setTimeout(() => callback(0), 10)
				}
			}),
			kill: vi.fn(),
		}
		mockSpawn.mockReturnValue(mockProcess as any)

		// Call listFiles with recursive=true
		const [result] = await listFiles("/test", true, 100)

		// Verify that .git subdirectories are NOT included
		const directories = result.filter((item) => item.endsWith("/"))

		// More specific checks - look for exact paths
		const hasSrcDir = directories.some((dir) => dir.endsWith("/test/src/") || dir.endsWith("src/"))
		const hasComponentsDir = directories.some(
			(dir) =>
				dir.endsWith("/test/src/components/") || dir.endsWith("src/components/") || dir.includes("components/"),
		)
		const hasGitDir = directories.some((dir) => dir.includes(".git/"))

		// Should include src/ and src/components/ but NOT .git/ or its subdirectories
		expect(hasSrcDir).toBe(true)
		expect(hasComponentsDir).toBe(true)

		// Should NOT include .git (hidden directories are excluded)
		expect(hasGitDir).toBe(false)
	})

	it("should allow explicit targeting of hidden directories", async () => {
		// Mock filesystem structure for explicit .roo-memory targeting
		const mockReaddir = vi.fn()
		vi.mocked(fs.promises).readdir = mockReaddir

		// Mock .roo-memory directory contents
		mockReaddir.mockResolvedValueOnce([
			{ name: "tasks", isDirectory: () => true, isSymbolicLink: () => false },
			{ name: "context", isDirectory: () => true, isSymbolicLink: () => false },
		])

		// Mock ripgrep to return no files
		const mockSpawn = vi.mocked(childProcess.spawn)
		const mockProcess = {
			stdout: {
				on: vi.fn((event, callback) => {
					if (event === "data") {
						// No files returned
					}
				}),
			},
			stderr: {
				on: vi.fn(),
			},
			on: vi.fn((event, callback) => {
				if (event === "close") {
					setTimeout(() => callback(0), 10)
				}
			}),
			kill: vi.fn(),
		}
		mockSpawn.mockReturnValue(mockProcess as any)

		// Call listFiles explicitly targeting .roo-memory directory
		const [result] = await listFiles("/test/.roo-memory", true, 100)

		// When explicitly targeting a hidden directory, its subdirectories should be included
		const directories = result.filter((item) => item.endsWith("/"))

		const hasTasksDir = directories.some((dir) => dir.includes(".roo-memory/tasks/") || dir.includes("tasks/"))
		const hasContextDir = directories.some(
			(dir) => dir.includes(".roo-memory/context/") || dir.includes("context/"),
		)

		expect(hasTasksDir).toBe(true)
		expect(hasContextDir).toBe(true)
	})

	it("should include top-level files when recursively listing a hidden directory that's also in DIRS_TO_IGNORE", async () => {
		// This test specifically addresses the bug where files at the root level of .roo/temp
		// were being excluded when using recursive listing
		const mockSpawn = vi.mocked(childProcess.spawn)
		const mockProcess = {
			stdout: {
				on: vi.fn((event, callback) => {
					if (event === "data") {
						// Simulate files that should be found in .roo/temp
						// Note: ripgrep returns relative paths
						setTimeout(() => {
							callback("teste1.md\n")
							callback("22/test2.md\n")
						}, 10)
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

		// Mock directory listing for .roo/temp
		const mockReaddir = vi.fn()
		vi.mocked(fs.promises).readdir = mockReaddir
		mockReaddir.mockResolvedValueOnce([{ name: "22", isDirectory: () => true, isSymbolicLink: () => false }])

		// Call listFiles targeting .roo/temp (which is both hidden and in DIRS_TO_IGNORE)
		const [files] = await listFiles("/test/.roo/temp", true, 100)

		// Verify ripgrep was called with correct arguments
		const [rgPath, args] = mockSpawn.mock.calls[0]
		expect(args).toContain("--no-ignore-vcs")
		expect(args).toContain("--no-ignore")

		// Check for the inclusion patterns that should be added
		expect(args).toContain("-g")
		const gIndex = args.indexOf("-g")
		expect(args[gIndex + 1]).toBe("*")

		// Verify that both top-level and nested files are included
		const fileNames = files.map((f) => path.basename(f))
		expect(fileNames).toContain("teste1.md")
		expect(fileNames).toContain("test2.md")

		// Ensure the top-level file is actually included
		const topLevelFile = files.find((f) => f.endsWith("teste1.md"))
		expect(topLevelFile).toBeTruthy()
	})
})

describe("buildRecursiveArgs edge cases", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("should correctly detect hidden directories with trailing slashes", async () => {
		const mockSpawn = vi.mocked(childProcess.spawn)
		const mockProcess = {
			stdout: {
				on: vi.fn((event, callback) => {
					if (event === "data") {
						setTimeout(() => callback("file.txt\n"), 10)
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

		// Test with trailing slash on hidden directory
		await listFiles("/test/.hidden/", true, 100)

		const [rgPath, args] = mockSpawn.mock.calls[0]
		// When targeting a hidden directory, these flags should be present
		expect(args).toContain("--no-ignore-vcs")
		expect(args).toContain("--no-ignore")
		expect(args).toContain("-g")
		const gIndex = args.indexOf("-g")
		expect(args[gIndex + 1]).toBe("*")
	})

	it("should correctly detect hidden directories with redundant separators", async () => {
		const mockSpawn = vi.mocked(childProcess.spawn)
		const mockProcess = {
			stdout: {
				on: vi.fn((event, callback) => {
					if (event === "data") {
						setTimeout(() => callback("file.txt\n"), 10)
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

		// Test with redundant separators before hidden directory
		await listFiles("/test//.hidden", true, 100)

		const [rgPath, args] = mockSpawn.mock.calls[0]
		// When targeting a hidden directory, these flags should be present
		expect(args).toContain("--no-ignore-vcs")
		expect(args).toContain("--no-ignore")
		expect(args).toContain("-g")
		const gIndex = args.indexOf("-g")
		expect(args[gIndex + 1]).toBe("*")
	})

	it("should correctly detect nested hidden directories with mixed separators", async () => {
		const mockSpawn = vi.mocked(childProcess.spawn)
		const mockProcess = {
			stdout: {
				on: vi.fn((event, callback) => {
					if (event === "data") {
						setTimeout(() => callback("file.txt\n"), 10)
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

		// Test with complex path including hidden directory
		await listFiles("/test//normal/.hidden//subdir/", true, 100)

		const [rgPath, args] = mockSpawn.mock.calls[0]
		// When targeting a path containing a hidden directory, these flags should be present
		expect(args).toContain("--no-ignore-vcs")
		expect(args).toContain("--no-ignore")
		expect(args).toContain("-g")
		const gIndex = args.indexOf("-g")
		expect(args[gIndex + 1]).toBe("*")
	})

	it("should not detect hidden directories when path only has dots in filenames", async () => {
		const mockSpawn = vi.mocked(childProcess.spawn)
		const mockProcess = {
			stdout: {
				on: vi.fn((event, callback) => {
					if (event === "data") {
						setTimeout(() => callback("file.txt\n"), 10)
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

		// Test with a path that has dots but no hidden directories
		await listFiles("/test/file.with.dots/normal", true, 100)

		const [rgPath, args] = mockSpawn.mock.calls[0]
		// Should NOT have the special flags for hidden directories
		expect(args).not.toContain("--no-ignore-vcs")
		expect(args).not.toContain("--no-ignore")
	})
})
