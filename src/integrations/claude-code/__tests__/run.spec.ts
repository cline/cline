import { describe, test, expect, vi, beforeEach } from "vitest"

// Mock vscode workspace
vi.mock("vscode", () => ({
	workspace: {
		workspaceFolders: [
			{
				uri: {
					fsPath: "/test/workspace",
				},
			},
		],
	},
}))

describe("runClaudeCode", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	test("should export runClaudeCode function", async () => {
		const { runClaudeCode } = await import("../run")
		expect(typeof runClaudeCode).toBe("function")
	})

	test("should be an async generator function", async () => {
		const { runClaudeCode } = await import("../run")
		const options = {
			systemPrompt: "You are a helpful assistant",
			messages: [{ role: "user" as const, content: "Hello" }],
		}

		const result = runClaudeCode(options)
		expect(Symbol.asyncIterator in result).toBe(true)
		expect(typeof result[Symbol.asyncIterator]).toBe("function")
	})
})
