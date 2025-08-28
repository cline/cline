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

vi.mock("child_process", () => ({
	spawn: vi.fn(),
}))

vi.mock("../../path", () => ({
	arePathsEqual: vi.fn().mockReturnValue(false),
}))

import { listFiles } from "../list-files"
import * as childProcess from "child_process"

describe("list-files gitignore support", () => {
	let tempDir: string
	let originalCwd: string

	beforeEach(async () => {
		vi.clearAllMocks()

		// Create a temporary directory for testing
		tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "roo-test-"))
		originalCwd = process.cwd()
		process.chdir(tempDir)
	})

	afterEach(async () => {
		process.chdir(originalCwd)
		// Clean up temp directory
		await fs.promises.rm(tempDir, { recursive: true, force: true })
	})

	it("should respect .gitignore patterns for directories in recursive mode", async () => {
		// Setup test directory structure
		await fs.promises.mkdir(path.join(tempDir, "src"))
		await fs.promises.mkdir(path.join(tempDir, "node_modules"))
		await fs.promises.mkdir(path.join(tempDir, "build"))
		await fs.promises.mkdir(path.join(tempDir, "ignored-dir"))

		// Create .gitignore file
		await fs.promises.writeFile(path.join(tempDir, ".gitignore"), "node_modules/\nbuild/\nignored-dir/\n")

		// Create some files
		await fs.promises.writeFile(path.join(tempDir, "src", "index.ts"), "")
		await fs.promises.writeFile(path.join(tempDir, "node_modules", "package.json"), "")
		await fs.promises.writeFile(path.join(tempDir, "build", "output.js"), "")
		await fs.promises.writeFile(path.join(tempDir, "ignored-dir", "file.txt"), "")

		// Mock ripgrep to return only non-ignored files
		const mockSpawn = vi.mocked(childProcess.spawn)
		const mockProcess = {
			stdout: {
				on: vi.fn((event, callback) => {
					if (event === "data") {
						// Ripgrep should respect .gitignore and only return src/index.ts
						setTimeout(() => callback(`${path.join(tempDir, "src", "index.ts")}\n`), 10)
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

		// Verify that gitignored directories are not included
		const directoriesInResult = files.filter((f) => f.endsWith("/"))

		expect(directoriesInResult).not.toContain(path.join(tempDir, "node_modules") + "/")
		expect(directoriesInResult).not.toContain(path.join(tempDir, "build") + "/")
		expect(directoriesInResult).not.toContain(path.join(tempDir, "ignored-dir") + "/")

		// But src/ should be included
		expect(directoriesInResult).toContain(path.join(tempDir, "src") + "/")
	})

	it("should handle nested .gitignore files", async () => {
		// Setup nested directory structure
		await fs.promises.mkdir(path.join(tempDir, "src"), { recursive: true })
		await fs.promises.mkdir(path.join(tempDir, "src", "components"))
		await fs.promises.mkdir(path.join(tempDir, "src", "temp"))

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

		// Verify that nested gitignored directories are not included
		const directoriesInResult = files.filter((f) => f.endsWith("/"))

		expect(directoriesInResult).not.toContain(path.join(tempDir, "src", "temp") + "/")
		expect(directoriesInResult).toContain(path.join(tempDir, "src") + "/")
		expect(directoriesInResult).toContain(path.join(tempDir, "src", "components") + "/")
	})
})
