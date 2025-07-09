import { vi, describe, it, expect, beforeEach, afterEach } from "vitest"
import * as path from "path"
import * as fs from "fs"
import * as os from "os"

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

// Mock child_process to simulate ripgrep behavior
vi.mock("child_process", () => ({
	spawn: vi.fn(),
}))

vi.mock("../../path", () => ({
	arePathsEqual: vi.fn().mockReturnValue(false),
}))

import { listFiles } from "../list-files"
import * as childProcess from "child_process"

describe("list-files gitignore integration", () => {
	let tempDir: string
	let originalCwd: string

	beforeEach(async () => {
		vi.clearAllMocks()

		// Create a temporary directory for testing
		tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "roo-gitignore-test-"))
		originalCwd = process.cwd()
	})

	afterEach(async () => {
		process.chdir(originalCwd)
		// Clean up temp directory
		await fs.promises.rm(tempDir, { recursive: true, force: true })
	})

	it("should properly filter directories based on .gitignore patterns", async () => {
		// Setup test directory structure
		await fs.promises.mkdir(path.join(tempDir, "src"))
		await fs.promises.mkdir(path.join(tempDir, "node_modules"))
		await fs.promises.mkdir(path.join(tempDir, "build"))
		await fs.promises.mkdir(path.join(tempDir, "dist"))
		await fs.promises.mkdir(path.join(tempDir, "allowed-dir"))

		// Create .gitignore file
		await fs.promises.writeFile(path.join(tempDir, ".gitignore"), "node_modules/\nbuild/\ndist/\n*.log\n")

		// Create some files
		await fs.promises.writeFile(path.join(tempDir, "src", "index.ts"), "console.log('hello')")
		await fs.promises.writeFile(path.join(tempDir, "allowed-dir", "file.txt"), "content")

		// Mock ripgrep to return files that would not be gitignored
		const mockSpawn = vi.mocked(childProcess.spawn)
		const mockProcess = {
			stdout: {
				on: vi.fn((event, callback) => {
					if (event === "data") {
						// Simulate ripgrep output (files that are not gitignored)
						const files =
							[path.join(tempDir, "src", "index.ts"), path.join(tempDir, "allowed-dir", "file.txt")].join(
								"\n",
							) + "\n"
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

		// Call listFiles in recursive mode
		const [files, didHitLimit] = await listFiles(tempDir, true, 100)

		// Filter out only directories from the results
		const directoriesInResult = files.filter((f) => f.endsWith("/"))

		// Verify that gitignored directories are NOT included
		expect(directoriesInResult).not.toContain(path.join(tempDir, "node_modules") + "/")
		expect(directoriesInResult).not.toContain(path.join(tempDir, "build") + "/")
		expect(directoriesInResult).not.toContain(path.join(tempDir, "dist") + "/")

		// Verify that allowed directories ARE included
		expect(directoriesInResult).toContain(path.join(tempDir, "src") + "/")
		expect(directoriesInResult).toContain(path.join(tempDir, "allowed-dir") + "/")
	})

	it("should handle nested .gitignore files correctly", async () => {
		// Setup nested directory structure
		await fs.promises.mkdir(path.join(tempDir, "src"), { recursive: true })
		await fs.promises.mkdir(path.join(tempDir, "src", "components"))
		await fs.promises.mkdir(path.join(tempDir, "src", "temp"))
		await fs.promises.mkdir(path.join(tempDir, "src", "utils"))

		// Create root .gitignore
		await fs.promises.writeFile(path.join(tempDir, ".gitignore"), "node_modules/\n")

		// Create nested .gitignore in src/
		await fs.promises.writeFile(path.join(tempDir, "src", ".gitignore"), "temp/\n")

		// Mock ripgrep
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

		// Call listFiles in recursive mode
		const [files, didHitLimit] = await listFiles(tempDir, true, 100)

		// Filter out only directories from the results
		const directoriesInResult = files.filter((f) => f.endsWith("/"))

		// Verify that nested gitignored directories are NOT included
		expect(directoriesInResult).not.toContain(path.join(tempDir, "src", "temp") + "/")

		// Verify that allowed directories ARE included
		expect(directoriesInResult).toContain(path.join(tempDir, "src") + "/")
		expect(directoriesInResult).toContain(path.join(tempDir, "src", "components") + "/")
		expect(directoriesInResult).toContain(path.join(tempDir, "src", "utils") + "/")
	})

	it("should respect .gitignore in non-recursive mode too", async () => {
		// Setup test directory structure
		await fs.promises.mkdir(path.join(tempDir, "src"))
		await fs.promises.mkdir(path.join(tempDir, "node_modules"))
		await fs.promises.mkdir(path.join(tempDir, "allowed-dir"))

		// Create .gitignore file
		await fs.promises.writeFile(path.join(tempDir, ".gitignore"), "node_modules/\n")

		// Mock ripgrep for non-recursive mode
		const mockSpawn = vi.mocked(childProcess.spawn)
		const mockProcess = {
			stdout: {
				on: vi.fn((event, callback) => {
					if (event === "data") {
						// In non-recursive mode, ripgrep should now respect .gitignore
						const files = [path.join(tempDir, "src"), path.join(tempDir, "allowed-dir")].join("\n") + "\n"
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

		// Call listFiles in NON-recursive mode
		const [files, didHitLimit] = await listFiles(tempDir, false, 100)

		// Verify ripgrep was called without --no-ignore-vcs (should respect .gitignore)
		const [rgPath, args] = mockSpawn.mock.calls[0]
		expect(args).not.toContain("--no-ignore-vcs")

		// Filter out only directories from the results
		const directoriesInResult = files.filter((f) => f.endsWith("/"))

		// Verify that gitignored directories are NOT included even in non-recursive mode
		expect(directoriesInResult).not.toContain(path.join(tempDir, "node_modules") + "/")

		// Verify that allowed directories ARE included
		expect(directoriesInResult).toContain(path.join(tempDir, "src") + "/")
		expect(directoriesInResult).toContain(path.join(tempDir, "allowed-dir") + "/")
	})
})
