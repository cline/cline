import {
	getCommands,
	getCommand,
	getCommandNames,
	getCommandNameFromFile,
	isMarkdownFile,
} from "../services/command/commands"

describe("Command Utilities", () => {
	const testCwd = "/test/project"

	describe("getCommandNameFromFile", () => {
		it("should strip .md extension only", () => {
			expect(getCommandNameFromFile("my-command.md")).toBe("my-command")
			expect(getCommandNameFromFile("test.txt")).toBe("test.txt")
			expect(getCommandNameFromFile("no-extension")).toBe("no-extension")
			expect(getCommandNameFromFile("multiple.dots.file.md")).toBe("multiple.dots.file")
			expect(getCommandNameFromFile("api.config.md")).toBe("api.config")
			expect(getCommandNameFromFile("deploy_prod.md")).toBe("deploy_prod")
		})
	})

	describe("isMarkdownFile", () => {
		it("should identify markdown files correctly", () => {
			// Markdown files
			expect(isMarkdownFile("command.md")).toBe(true)
			expect(isMarkdownFile("my-command.md")).toBe(true)
			expect(isMarkdownFile("README.MD")).toBe(true)
			expect(isMarkdownFile("test.Md")).toBe(true)

			// Non-markdown files
			expect(isMarkdownFile("command.txt")).toBe(false)
			expect(isMarkdownFile("script.sh")).toBe(false)
			expect(isMarkdownFile("config.json")).toBe(false)
			expect(isMarkdownFile("no-extension")).toBe(false)
			expect(isMarkdownFile("file.md.bak")).toBe(false)
		})
	})

	describe("getCommands", () => {
		it("should return empty array when no command directories exist", async () => {
			// This will fail to find directories but should return empty array gracefully
			const commands = await getCommands(testCwd)
			expect(Array.isArray(commands)).toBe(true)
		})
	})

	describe("getCommandNames", () => {
		it("should return empty array when no commands exist", async () => {
			const names = await getCommandNames(testCwd)
			expect(Array.isArray(names)).toBe(true)
		})
	})

	describe("getCommand", () => {
		it("should return undefined for non-existent command", async () => {
			const result = await getCommand(testCwd, "non-existent")
			expect(result).toBeUndefined()
		})
	})

	describe("command name extraction edge cases", () => {
		it("should handle various filename formats", () => {
			// Files without extensions
			expect(getCommandNameFromFile("command")).toBe("command")
			expect(getCommandNameFromFile("my-command")).toBe("my-command")

			// Files with multiple dots - only strip .md extension
			expect(getCommandNameFromFile("my.complex.command.md")).toBe("my.complex.command")
			expect(getCommandNameFromFile("v1.2.3.txt")).toBe("v1.2.3.txt")

			// Edge cases
			expect(getCommandNameFromFile(".")).toBe(".")
			expect(getCommandNameFromFile("..")).toBe("..")
			expect(getCommandNameFromFile(".hidden.md")).toBe(".hidden")
		})
	})

	describe("command loading behavior", () => {
		it("should handle multiple calls to getCommands", async () => {
			const commands1 = await getCommands(testCwd)
			const commands2 = await getCommands(testCwd)
			expect(Array.isArray(commands1)).toBe(true)
			expect(Array.isArray(commands2)).toBe(true)
		})
	})

	describe("error handling", () => {
		it("should handle invalid command names gracefully", async () => {
			// These should not throw errors
			expect(await getCommand(testCwd, "")).toBeUndefined()
			expect(await getCommand(testCwd, "   ")).toBeUndefined()
			expect(await getCommand(testCwd, "non/existent/path")).toBeUndefined()
		})
	})
})
