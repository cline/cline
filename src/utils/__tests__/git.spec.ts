import { ExecException } from "child_process"
import { vitest, describe, it, expect, beforeEach } from "vitest"

import { searchCommits, getCommitInfo, getWorkingState } from "../git"

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
