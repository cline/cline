import * as path from "path"
import * as fs from "fs"
import { listFiles } from "../list-files"

// Mock ripgrep
vi.mock("../../ripgrep", () => ({
	getBinPath: vi.fn().mockResolvedValue("/mock/path/to/rg"),
}))

// Mock vscode
vi.mock("vscode", () => ({
	env: {
		appRoot: "/mock/app/root",
	},
}))

// Mock child_process
vi.mock("child_process", () => ({
	spawn: vi.fn(),
}))

vi.mock("../../../utils/path", () => ({
	arePathsEqual: vi.fn().mockReturnValue(false),
}))

import * as childProcess from "child_process"

describe("listFiles limit handling for large projects", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("should prevent stack overflow when scanning large projects", async () => {
		// This test verifies that the fix prevents the "Maximum call stack size exceeded" error
		// by ensuring the function completes successfully even with a very large directory structure

		const createMockDirEntry = (name: string) =>
			({
				name,
				isDirectory: () => true,
				isSymbolicLink: () => false,
				isFile: () => false,
			}) as any

		const mockReaddir = vi.fn()
		vi.mocked(fs.promises).readdir = mockReaddir

		// Simulate a project with 200k+ items (as mentioned in the issue)
		// Create a broad directory tree that would cause stack overflow without proper limits
		let callCount = 0
		const maxDepth = 100 // Simulate deep nesting
		mockReaddir.mockImplementation(async () => {
			callCount++
			if (callCount > maxDepth) {
				return []
			}
			// Return many subdirectories at each level to simulate a large codebase
			return Array(50)
				.fill(null)
				.map((_, i) => createMockDirEntry(`dir${callCount}_${i}`))
		})

		// Mock ripgrep to return many files
		const mockSpawn = vi.mocked(childProcess.spawn)
		const mockProcess = {
			stdout: {
				on: vi.fn((event, callback) => {
					if (event === "data") {
						// Return many files to simulate large project
						const files =
							Array(10000)
								.fill(null)
								.map((_, i) => `file${i}.ts`)
								.join("\n") + "\n"
						setTimeout(() => callback(files), 10)
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

		// Call listFiles with a limit that would be used in code indexing
		const limit = 50_000 // MAX_LIST_FILES_LIMIT_CODE_INDEX value

		// The key test: this should complete without throwing a stack overflow error
		let error: Error | null = null
		let results: string[] = []
		let limitReached = false

		try {
			const startTime = Date.now()
			const [res, didHitLimit] = await listFiles("/test/large-project", true, limit)
			const endTime = Date.now()

			results = res
			limitReached = didHitLimit

			// Should complete in reasonable time
			expect(endTime - startTime).toBeLessThan(10000) // 10 seconds max
		} catch (e) {
			error = e as Error
		}

		// Main assertion: no stack overflow error should occur
		expect(error).toBeNull()

		// The function should return valid results
		expect(results).toBeDefined()
		expect(Array.isArray(results)).toBe(true)

		// The limit should be respected
		expect(results.length).toBeLessThanOrEqual(limit)

		// Directory scanning should respect the overall limit
		const directories = results.filter((r) => r.endsWith("/"))
		const files = results.filter((r) => !r.endsWith("/"))
		expect(directories.length + files.length).toBeLessThanOrEqual(limit)
	})

	it("should terminate early when directory limit is reached", async () => {
		const createMockDirEntry = (name: string) =>
			({
				name,
				isDirectory: () => true,
				isSymbolicLink: () => false,
				isFile: () => false,
			}) as any

		const mockReaddir = vi.fn()
		vi.mocked(fs.promises).readdir = mockReaddir

		// Mock directory structure
		let directoriesScanned = 0
		mockReaddir.mockImplementation(async (dirPath: string) => {
			directoriesScanned++

			// Root directory has many subdirectories
			if (directoriesScanned === 1) {
				return Array(100)
					.fill(null)
					.map((_, i) => createMockDirEntry(`subdir${i}`))
			}

			// Each subdirectory has more subdirectories
			return Array(50)
				.fill(null)
				.map((_, i) => createMockDirEntry(`nested${directoriesScanned}_${i}`))
		})

		// Mock ripgrep to return no files (focus on directory scanning)
		const mockSpawn = vi.mocked(childProcess.spawn)
		const mockProcess = {
			stdout: {
				on: vi.fn((event, callback) => {
					if (event === "data") {
						setTimeout(() => callback(""), 10)
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

		// Call listFiles with a small limit
		const limit = 10
		const [results, limitReached] = await listFiles("/test/project", true, limit)

		// Verify results respect the limit
		expect(results.length).toBeLessThanOrEqual(limit)
		expect(limitReached).toBe(true)

		// Verify that directory scanning terminated early
		// Without the fix, this would scan thousands of directories
		// With the fix, it should stop after reaching the limit
		const directories = results.filter((r) => r.endsWith("/"))
		expect(directories.length).toBeLessThanOrEqual(limit)

		// The number of readdir calls should be proportional to the limit, not unbounded
		// This ensures we're not scanning the entire tree before applying the limit
		expect(directoriesScanned).toBeLessThan(limit * 10) // Allow some overhead but not excessive
	})

	it("should handle zero limit gracefully", async () => {
		// This test is already in the original spec but let's ensure it works with our changes
		const [results, limitReached] = await listFiles("/test/path", true, 0)

		expect(results).toEqual([])
		expect(limitReached).toBe(false)

		// No filesystem operations should occur with zero limit
		expect(fs.promises.readdir).not.toHaveBeenCalled()
		expect(childProcess.spawn).not.toHaveBeenCalled()
	})

	it("should correctly distribute limit between files and directories", async () => {
		const createMockDirEntry = (name: string) =>
			({
				name,
				isDirectory: () => true,
				isSymbolicLink: () => false,
				isFile: () => false,
			}) as any

		const mockReaddir = vi.fn()
		vi.mocked(fs.promises).readdir = mockReaddir

		// Mock directory with some subdirectories
		mockReaddir
			.mockResolvedValueOnce([createMockDirEntry("dir1"), createMockDirEntry("dir2"), createMockDirEntry("dir3")])
			.mockResolvedValue([]) // Empty subdirectories

		// Mock ripgrep to return files
		const mockSpawn = vi.mocked(childProcess.spawn)
		const mockProcess = {
			stdout: {
				on: vi.fn((event, callback) => {
					if (event === "data") {
						// Return 8 files
						const files =
							Array(8)
								.fill(null)
								.map((_, i) => `file${i}.ts`)
								.join("\n") + "\n"
						setTimeout(() => callback(files), 10)
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

		// Call with limit of 10
		const [results, limitReached] = await listFiles("/test/project", true, 10)

		// Should include both files and directories up to the limit
		expect(results.length).toBe(10)
		expect(limitReached).toBe(true)

		const files = results.filter((r) => !r.endsWith("/"))
		const directories = results.filter((r) => r.endsWith("/"))

		// Should have both files and directories
		expect(files.length).toBeGreaterThan(0)
		expect(directories.length).toBeGreaterThan(0)

		// Total should equal the limit
		expect(files.length + directories.length).toBe(10)
	})
})
