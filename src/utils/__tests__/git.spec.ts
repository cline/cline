import { ExecException } from "child_process"
import * as vscode from "vscode"
import * as fs from "fs"
import * as path from "path"

import {
	searchCommits,
	getCommitInfo,
	getWorkingState,
	getGitRepositoryInfo,
	sanitizeGitUrl,
	extractRepositoryName,
	getWorkspaceGitInfo,
	GitRepositoryInfo,
} from "../git"
import { truncateOutput } from "../../integrations/misc/extract-text"

type ExecFunction = (
	command: string,
	options: { cwd?: string },
	callback: (error: ExecException | null, result?: { stdout: string; stderr: string }) => void,
) => void

type PromisifiedExec = (command: string, options?: { cwd?: string }) => Promise<{ stdout: string; stderr: string }>

// Mock child_process.exec
vitest.mock("child_process", () => ({
	exec: vitest.fn(),
}))

// Mock fs.promises
vitest.mock("fs", () => ({
	promises: {
		access: vitest.fn(),
		readFile: vitest.fn(),
	},
}))

// Create a mock for vscode
const mockWorkspaceFolders = vitest.fn()
vitest.mock("vscode", () => ({
	workspace: {
		get workspaceFolders() {
			return mockWorkspaceFolders()
		},
	},
}))

// Mock util.promisify to return our own mock function
vitest.mock("util", () => ({
	promisify: vitest.fn((fn: ExecFunction): PromisifiedExec => {
		return async (command: string, options?: { cwd?: string }) => {
			// Call the original mock to maintain the mock implementation
			return new Promise((resolve, reject) => {
				fn(
					command,
					options || {},
					(error: ExecException | null, result?: { stdout: string; stderr: string }) => {
						if (error) {
							reject(error)
						} else {
							resolve(result!)
						}
					},
				)
			})
		}
	}),
}))

// Mock extract-text
vitest.mock("../../integrations/misc/extract-text", () => ({
	truncateOutput: vitest.fn((text) => text),
}))

import { exec } from "child_process"

describe("git utils", () => {
	const cwd = "/test/path"

	beforeEach(() => {
		vitest.clearAllMocks()
	})

	describe("searchCommits", () => {
		const mockCommitData = [
			"abc123def456",
			"abc123",
			"fix: test commit",
			"John Doe",
			"2024-01-06",
			"def456abc789",
			"def456",
			"feat: new feature",
			"Jane Smith",
			"2024-01-05",
		].join("\n")

		it("should return commits when git is installed and repo exists", async () => {
			// Set up mock responses
			const responses = new Map([
				["git --version", { stdout: "git version 2.39.2", stderr: "" }],
				["git rev-parse --git-dir", { stdout: ".git", stderr: "" }],
				[
					'git log -n 10 --format="%H%n%h%n%s%n%an%n%ad" --date=short --grep="test" --regexp-ignore-case',
					{ stdout: mockCommitData, stderr: "" },
				],
			])

			vitest.mocked(exec).mockImplementation((command: string, options: any, callback: any) => {
				// Find matching response
				for (const [cmd, response] of responses) {
					if (command === cmd) {
						callback(null, response)
						return {} as any
					}
				}
				callback(new Error(`Unexpected command: ${command}`))
			})

			const result = await searchCommits("test", cwd)

			// First verify the result is correct
			expect(result).toHaveLength(2)
			expect(result[0]).toEqual({
				hash: "abc123def456",
				shortHash: "abc123",
				subject: "fix: test commit",
				author: "John Doe",
				date: "2024-01-06",
			})

			// Then verify all commands were called correctly
			expect(vitest.mocked(exec)).toHaveBeenCalledWith("git --version", {}, expect.any(Function))
			expect(vitest.mocked(exec)).toHaveBeenCalledWith("git rev-parse --git-dir", { cwd }, expect.any(Function))
			expect(vitest.mocked(exec)).toHaveBeenCalledWith(
				'git log -n 10 --format="%H%n%h%n%s%n%an%n%ad" --date=short --grep="test" --regexp-ignore-case',
				{ cwd },
				expect.any(Function),
			)
		})

		it("should return empty array when git is not installed", async () => {
			vitest.mocked(exec).mockImplementation((command: string, options: any, callback: any) => {
				if (command === "git --version") {
					callback(new Error("git not found"))
					return {} as any
				}
				callback(new Error("Unexpected command"))
				return {} as any
			})

			const result = await searchCommits("test", cwd)
			expect(result).toEqual([])
			expect(vitest.mocked(exec)).toHaveBeenCalledWith("git --version", {}, expect.any(Function))
		})

		it("should return empty array when not in a git repository", async () => {
			const responses = new Map([
				["git --version", { stdout: "git version 2.39.2", stderr: "" }],
				["git rev-parse --git-dir", null], // null indicates error should be called
			])

			vitest.mocked(exec).mockImplementation((command: string, options: any, callback: any) => {
				const response = responses.get(command)
				if (response === null) {
					callback(new Error("not a git repository"))
					return {} as any
				} else if (response) {
					callback(null, response)
					return {} as any
				} else {
					callback(new Error("Unexpected command"))
					return {} as any
				}
			})

			const result = await searchCommits("test", cwd)
			expect(result).toEqual([])
			expect(vitest.mocked(exec)).toHaveBeenCalledWith("git --version", {}, expect.any(Function))
			expect(vitest.mocked(exec)).toHaveBeenCalledWith("git rev-parse --git-dir", { cwd }, expect.any(Function))
		})

		it("should handle hash search when grep search returns no results", async () => {
			const responses = new Map([
				["git --version", { stdout: "git version 2.39.2", stderr: "" }],
				["git rev-parse --git-dir", { stdout: ".git", stderr: "" }],
				[
					'git log -n 10 --format="%H%n%h%n%s%n%an%n%ad" --date=short --grep="abc123" --regexp-ignore-case',
					{ stdout: "", stderr: "" },
				],
				[
					'git log -n 10 --format="%H%n%h%n%s%n%an%n%ad" --date=short --author-date-order abc123',
					{ stdout: mockCommitData, stderr: "" },
				],
			])

			vitest.mocked(exec).mockImplementation((command: string, options: any, callback: any) => {
				for (const [cmd, response] of responses) {
					if (command === cmd) {
						callback(null, response)
						return {} as any
					}
				}
				callback(new Error("Unexpected command"))
				return {} as any
			})

			const result = await searchCommits("abc123", cwd)
			expect(result).toHaveLength(2)
			expect(result[0]).toEqual({
				hash: "abc123def456",
				shortHash: "abc123",
				subject: "fix: test commit",
				author: "John Doe",
				date: "2024-01-06",
			})
		})
	})

	describe("getCommitInfo", () => {
		const mockCommitInfo = [
			"abc123def456",
			"abc123",
			"fix: test commit",
			"John Doe",
			"2024-01-06",
			"Detailed description",
		].join("\n")
		const mockStats = "1 file changed, 2 insertions(+), 1 deletion(-)"
		const mockDiff = "@@ -1,1 +1,2 @@\n-old line\n+new line"

		it("should return formatted commit info", async () => {
			const responses = new Map([
				["git --version", { stdout: "git version 2.39.2", stderr: "" }],
				["git rev-parse --git-dir", { stdout: ".git", stderr: "" }],
				[
					'git show --format="%H%n%h%n%s%n%an%n%ad%n%b" --no-patch abc123',
					{ stdout: mockCommitInfo, stderr: "" },
				],
				['git show --stat --format="" abc123', { stdout: mockStats, stderr: "" }],
				['git show --format="" abc123', { stdout: mockDiff, stderr: "" }],
			])

			vitest.mocked(exec).mockImplementation((command: string, options: any, callback: any) => {
				for (const [cmd, response] of responses) {
					if (command.startsWith(cmd)) {
						callback(null, response)
						return {} as any
					}
				}
				callback(new Error("Unexpected command"))
				return {} as any
			})

			const result = await getCommitInfo("abc123", cwd)
			expect(result).toContain("Commit: abc123")
			expect(result).toContain("Author: John Doe")
			expect(result).toContain("Files Changed:")
			expect(result).toContain("Full Changes:")
			expect(vitest.mocked(truncateOutput)).toHaveBeenCalled()
		})

		it("should return error message when git is not installed", async () => {
			vitest.mocked(exec).mockImplementation((command: string, options: any, callback: any) => {
				if (command === "git --version") {
					callback(new Error("git not found"))
					return {} as any
				}
				callback(new Error("Unexpected command"))
				return {} as any
			})

			const result = await getCommitInfo("abc123", cwd)
			expect(result).toBe("Git is not installed")
		})

		it("should return error message when not in a git repository", async () => {
			const responses = new Map([
				["git --version", { stdout: "git version 2.39.2", stderr: "" }],
				["git rev-parse --git-dir", null], // null indicates error should be called
			])

			vitest.mocked(exec).mockImplementation((command: string, options: any, callback: any) => {
				const response = responses.get(command)
				if (response === null) {
					callback(new Error("not a git repository"))
					return {} as any
				} else if (response) {
					callback(null, response)
					return {} as any
				} else {
					callback(new Error("Unexpected command"))
					return {} as any
				}
			})

			const result = await getCommitInfo("abc123", cwd)
			expect(result).toBe("Not a git repository")
		})
	})

	describe("getWorkingState", () => {
		const mockStatus = " M src/file1.ts\n?? src/file2.ts"
		const mockDiff = "@@ -1,1 +1,2 @@\n-old line\n+new line"

		it("should return working directory changes", async () => {
			const responses = new Map([
				["git --version", { stdout: "git version 2.39.2", stderr: "" }],
				["git rev-parse --git-dir", { stdout: ".git", stderr: "" }],
				["git status --short", { stdout: mockStatus, stderr: "" }],
				["git diff HEAD", { stdout: mockDiff, stderr: "" }],
			])

			vitest.mocked(exec).mockImplementation((command: string, options: any, callback: any) => {
				for (const [cmd, response] of responses) {
					if (command === cmd) {
						callback(null, response)
						return {} as any
					}
				}
				callback(new Error("Unexpected command"))
				return {} as any
			})

			const result = await getWorkingState(cwd)
			expect(result).toContain("Working directory changes:")
			expect(result).toContain("src/file1.ts")
			expect(result).toContain("src/file2.ts")
			expect(vitest.mocked(truncateOutput)).toHaveBeenCalled()
		})

		it("should return message when working directory is clean", async () => {
			const responses = new Map([
				["git --version", { stdout: "git version 2.39.2", stderr: "" }],
				["git rev-parse --git-dir", { stdout: ".git", stderr: "" }],
				["git status --short", { stdout: "", stderr: "" }],
			])

			vitest.mocked(exec).mockImplementation((command: string, options: any, callback: any) => {
				for (const [cmd, response] of responses) {
					if (command === cmd) {
						callback(null, response)
						return {} as any
					}
				}
				callback(new Error("Unexpected command"))
				return {} as any
			})

			const result = await getWorkingState(cwd)
			expect(result).toBe("No changes in working directory")
		})

		it("should return error message when git is not installed", async () => {
			vitest.mocked(exec).mockImplementation((command: string, options: any, callback: any) => {
				if (command === "git --version") {
					callback(new Error("git not found"))
					return {} as any
				}
				callback(new Error("Unexpected command"))
				return {} as any
			})

			const result = await getWorkingState(cwd)
			expect(result).toBe("Git is not installed")
		})

		it("should return error message when not in a git repository", async () => {
			const responses = new Map([
				["git --version", { stdout: "git version 2.39.2", stderr: "" }],
				["git rev-parse --git-dir", null], // null indicates error should be called
			])

			vitest.mocked(exec).mockImplementation((command: string, options: any, callback: any) => {
				const response = responses.get(command)
				if (response === null) {
					callback(new Error("not a git repository"))
					return {} as any
				} else if (response) {
					callback(null, response)
					return {} as any
				} else {
					callback(new Error("Unexpected command"))
					return {} as any
				}
			})

			const result = await getWorkingState(cwd)
			expect(result).toBe("Not a git repository")
		})
	})
})

describe("getGitRepositoryInfo", () => {
	const workspaceRoot = "/test/workspace"
	const gitDir = path.join(workspaceRoot, ".git")
	const configPath = path.join(gitDir, "config")
	const headPath = path.join(gitDir, "HEAD")

	beforeEach(() => {
		vitest.clearAllMocks()
	})

	it("should return empty object when not a git repository", async () => {
		// Mock fs.access to throw error (directory doesn't exist)
		vitest.mocked(fs.promises.access).mockRejectedValueOnce(new Error("ENOENT"))

		const result = await getGitRepositoryInfo(workspaceRoot)

		expect(result).toEqual({})
		expect(fs.promises.access).toHaveBeenCalledWith(gitDir)
	})

	it("should extract repository info from git config", async () => {
		// Clear previous mocks
		vitest.clearAllMocks()

		// Create a spy to track the implementation
		const gitSpy = vitest.spyOn(fs.promises, "readFile")

		// Mock successful access to .git directory
		vitest.mocked(fs.promises.access).mockResolvedValue(undefined)

		// Mock git config file content
		const mockConfig = `
[core]
 repositoryformatversion = 0
 filemode = true
 bare = false
 logallrefupdates = true
 ignorecase = true
 precomposeunicode = true
[remote "origin"]
 url = https://github.com/RooCodeInc/Roo-Code.git
 fetch = +refs/heads/*:refs/remotes/origin/*
[branch "main"]
 remote = origin
 merge = refs/heads/main
`
		// Mock HEAD file content
		const mockHead = "ref: refs/heads/main"

		// Setup the readFile mock to return different values based on the path
		gitSpy.mockImplementation((path: any, encoding: any) => {
			if (path === configPath) {
				return Promise.resolve(mockConfig)
			} else if (path === headPath) {
				return Promise.resolve(mockHead)
			}
			return Promise.reject(new Error(`Unexpected path: ${path}`))
		})

		const result = await getGitRepositoryInfo(workspaceRoot)

		expect(result).toEqual({
			repositoryUrl: "https://github.com/RooCodeInc/Roo-Code.git",
			repositoryName: "RooCodeInc/Roo-Code",
			defaultBranch: "main",
		})

		// Verify config file was read
		expect(gitSpy).toHaveBeenCalledWith(configPath, "utf8")

		// The implementation might not always read the HEAD file if it already found the branch in config
		// So we don't assert that it was called
	})

	it("should handle missing repository URL in config", async () => {
		// Clear previous mocks
		vitest.clearAllMocks()

		// Create a spy to track the implementation
		const gitSpy = vitest.spyOn(fs.promises, "readFile")

		// Mock successful access to .git directory
		vitest.mocked(fs.promises.access).mockResolvedValue(undefined)

		// Mock git config file without URL
		const mockConfig = `
[core]
 repositoryformatversion = 0
 filemode = true
 bare = false
`
		// Mock HEAD file content
		const mockHead = "ref: refs/heads/main"

		// Setup the readFile mock to return different values based on the path
		gitSpy.mockImplementation((path: any, encoding: any) => {
			if (path === configPath) {
				return Promise.resolve(mockConfig)
			} else if (path === headPath) {
				return Promise.resolve(mockHead)
			}
			return Promise.reject(new Error(`Unexpected path: ${path}`))
		})

		const result = await getGitRepositoryInfo(workspaceRoot)

		expect(result).toEqual({
			defaultBranch: "main",
		})
	})

	it("should handle errors when reading git config", async () => {
		// Clear previous mocks
		vitest.clearAllMocks()

		// Create a spy to track the implementation
		const gitSpy = vitest.spyOn(fs.promises, "readFile")

		// Mock successful access to .git directory
		vitest.mocked(fs.promises.access).mockResolvedValue(undefined)

		// Setup the readFile mock to return different values based on the path
		gitSpy.mockImplementation((path: any, encoding: any) => {
			if (path === configPath) {
				return Promise.reject(new Error("Failed to read config"))
			} else if (path === headPath) {
				return Promise.resolve("ref: refs/heads/main")
			}
			return Promise.reject(new Error(`Unexpected path: ${path}`))
		})

		const result = await getGitRepositoryInfo(workspaceRoot)

		expect(result).toEqual({
			defaultBranch: "main",
		})
	})

	it("should handle errors when reading HEAD file", async () => {
		// Clear previous mocks
		vitest.clearAllMocks()

		// Create a spy to track the implementation
		const gitSpy = vitest.spyOn(fs.promises, "readFile")

		// Mock successful access to .git directory
		vitest.mocked(fs.promises.access).mockResolvedValue(undefined)

		// Setup the readFile mock to return different values based on the path
		gitSpy.mockImplementation((path: any, encoding: any) => {
			if (path === configPath) {
				return Promise.resolve(`
[remote "origin"]
 url = https://github.com/RooCodeInc/Roo-Code.git
`)
			} else if (path === headPath) {
				return Promise.reject(new Error("Failed to read HEAD"))
			}
			return Promise.reject(new Error(`Unexpected path: ${path}`))
		})

		const result = await getGitRepositoryInfo(workspaceRoot)

		expect(result).toEqual({
			repositoryUrl: "https://github.com/RooCodeInc/Roo-Code.git",
			repositoryName: "RooCodeInc/Roo-Code",
		})
	})
})

describe("sanitizeGitUrl", () => {
	it("should sanitize HTTPS URLs with credentials", () => {
		const url = "https://username:password@github.com/RooCodeInc/Roo-Code.git"
		const sanitized = sanitizeGitUrl(url)

		expect(sanitized).toBe("https://github.com/RooCodeInc/Roo-Code.git")
	})

	it("should leave SSH URLs unchanged", () => {
		const url = "git@github.com:RooCodeInc/Roo-Code.git"
		const sanitized = sanitizeGitUrl(url)

		expect(sanitized).toBe("git@github.com:RooCodeInc/Roo-Code.git")
	})

	it("should leave SSH URLs with ssh:// prefix unchanged", () => {
		const url = "ssh://git@github.com/RooCodeInc/Roo-Code.git"
		const sanitized = sanitizeGitUrl(url)

		expect(sanitized).toBe("ssh://git@github.com/RooCodeInc/Roo-Code.git")
	})

	it("should remove tokens from other URL formats", () => {
		const url = "https://oauth2:ghp_abcdef1234567890abcdef1234567890abcdef@github.com/RooCodeInc/Roo-Code.git"
		const sanitized = sanitizeGitUrl(url)

		expect(sanitized).toBe("https://github.com/RooCodeInc/Roo-Code.git")
	})

	it("should handle invalid URLs gracefully", () => {
		const url = "not-a-valid-url"
		const sanitized = sanitizeGitUrl(url)

		expect(sanitized).toBe("not-a-valid-url")
	})
})

describe("extractRepositoryName", () => {
	it("should extract repository name from HTTPS URL", () => {
		const url = "https://github.com/RooCodeInc/Roo-Code.git"
		const repoName = extractRepositoryName(url)

		expect(repoName).toBe("RooCodeInc/Roo-Code")
	})

	it("should extract repository name from HTTPS URL without .git suffix", () => {
		const url = "https://github.com/RooCodeInc/Roo-Code"
		const repoName = extractRepositoryName(url)

		expect(repoName).toBe("RooCodeInc/Roo-Code")
	})

	it("should extract repository name from SSH URL", () => {
		const url = "git@github.com:RooCodeInc/Roo-Code.git"
		const repoName = extractRepositoryName(url)

		expect(repoName).toBe("RooCodeInc/Roo-Code")
	})

	it("should extract repository name from SSH URL with ssh:// prefix", () => {
		const url = "ssh://git@github.com/RooCodeInc/Roo-Code.git"
		const repoName = extractRepositoryName(url)

		expect(repoName).toBe("RooCodeInc/Roo-Code")
	})

	it("should return empty string for unrecognized URL formats", () => {
		const url = "not-a-valid-git-url"
		const repoName = extractRepositoryName(url)

		expect(repoName).toBe("")
	})

	it("should handle URLs with credentials", () => {
		const url = "https://username:password@github.com/RooCodeInc/Roo-Code.git"
		const repoName = extractRepositoryName(url)

		expect(repoName).toBe("RooCodeInc/Roo-Code")
	})
})

describe("getWorkspaceGitInfo", () => {
	const workspaceRoot = "/test/workspace"

	beforeEach(() => {
		vitest.clearAllMocks()
	})

	it("should return empty object when no workspace folders", async () => {
		// Mock workspace with no folders
		mockWorkspaceFolders.mockReturnValue(undefined)

		const result = await getWorkspaceGitInfo()

		expect(result).toEqual({})
	})

	it("should return git info for the first workspace folder", async () => {
		// Clear previous mocks
		vitest.clearAllMocks()

		// Mock workspace with one folder
		mockWorkspaceFolders.mockReturnValue([{ uri: { fsPath: workspaceRoot }, name: "workspace", index: 0 }])

		// Create a spy to track the implementation
		const gitSpy = vitest.spyOn(fs.promises, "access")
		const readFileSpy = vitest.spyOn(fs.promises, "readFile")

		// Mock successful access to .git directory
		gitSpy.mockResolvedValue(undefined)

		// Mock git config file content
		const mockConfig = `
[remote "origin"]
 url = https://github.com/RooCodeInc/Roo-Code.git
[branch "main"]
 remote = origin
 merge = refs/heads/main
`

		// Setup the readFile mock to return config content
		readFileSpy.mockImplementation((path: any, encoding: any) => {
			if (path.includes("config")) {
				return Promise.resolve(mockConfig)
			}
			return Promise.reject(new Error(`Unexpected path: ${path}`))
		})

		const result = await getWorkspaceGitInfo()

		expect(result).toEqual({
			repositoryUrl: "https://github.com/RooCodeInc/Roo-Code.git",
			repositoryName: "RooCodeInc/Roo-Code",
			defaultBranch: "main",
		})

		// Verify the fs operations were called with the correct workspace path
		expect(gitSpy).toHaveBeenCalled()
		expect(readFileSpy).toHaveBeenCalled()
	})
})
