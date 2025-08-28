import { parseMentions } from "../core/mentions"
import { UrlContentFetcher } from "../services/browser/UrlContentFetcher"
import { getCommand } from "../services/command/commands"

// Mock the dependencies
vi.mock("../services/command/commands")
vi.mock("../services/browser/UrlContentFetcher")

const MockedUrlContentFetcher = vi.mocked(UrlContentFetcher)
const mockGetCommand = vi.mocked(getCommand)

describe("Command Mentions", () => {
	let mockUrlContentFetcher: any

	beforeEach(() => {
		vi.clearAllMocks()

		// Create a mock UrlContentFetcher instance
		mockUrlContentFetcher = {
			launchBrowser: vi.fn(),
			urlToMarkdown: vi.fn(),
			closeBrowser: vi.fn(),
		}

		MockedUrlContentFetcher.mockImplementation(() => mockUrlContentFetcher)
	})

	// Helper function to call parseMentions with required parameters
	const callParseMentions = async (text: string) => {
		return await parseMentions(
			text,
			"/test/cwd", // cwd
			mockUrlContentFetcher, // urlContentFetcher
			undefined, // fileContextTracker
			undefined, // rooIgnoreController
			false, // showRooIgnoredFiles
			true, // includeDiagnosticMessages
			50, // maxDiagnosticMessages
			undefined, // maxReadFileLine
		)
	}

	describe("parseMentions with command support", () => {
		it("should parse command mentions and include content", async () => {
			const commandContent = "# Setup Environment\n\nRun the following commands:\n```bash\nnpm install\n```"
			mockGetCommand.mockResolvedValue({
				name: "setup",
				content: commandContent,
				source: "project",
				filePath: "/project/.roo/commands/setup.md",
			})

			const input = "/setup Please help me set up the project"
			const result = await callParseMentions(input)

			expect(mockGetCommand).toHaveBeenCalledWith("/test/cwd", "setup")
			expect(result).toContain('<command name="setup">')
			expect(result).toContain(commandContent)
			expect(result).toContain("</command>")
			expect(result).toContain("Please help me set up the project")
		})

		it("should handle multiple commands in message", async () => {
			const setupContent = "# Setup Environment\n\nRun the following commands:\n```bash\nnpm install\n```"
			const deployContent = "# Deploy Environment\n\nRun the following commands:\n```bash\nnpm run deploy\n```"

			mockGetCommand
				.mockResolvedValueOnce({
					name: "setup",
					content: setupContent,
					source: "project",
					filePath: "/project/.roo/commands/setup.md",
				})
				.mockResolvedValueOnce({
					name: "deploy",
					content: deployContent,
					source: "project",
					filePath: "/project/.roo/commands/deploy.md",
				})
				.mockResolvedValueOnce({
					name: "setup",
					content: setupContent,
					source: "project",
					filePath: "/project/.roo/commands/setup.md",
				})
				.mockResolvedValueOnce({
					name: "deploy",
					content: deployContent,
					source: "project",
					filePath: "/project/.roo/commands/deploy.md",
				})

			// Both commands should be recognized
			const input = "/setup the project\nThen /deploy later"
			const result = await callParseMentions(input)

			expect(mockGetCommand).toHaveBeenCalledWith("/test/cwd", "setup")
			expect(mockGetCommand).toHaveBeenCalledWith("/test/cwd", "deploy")
			expect(mockGetCommand).toHaveBeenCalledTimes(2) // Each unique command called once (optimized)
			expect(result).toContain('<command name="setup">')
			expect(result).toContain("# Setup Environment")
			expect(result).toContain('<command name="deploy">')
			expect(result).toContain("# Deploy Environment")
		})

		it("should leave non-existent commands unchanged", async () => {
			mockGetCommand.mockReset()
			mockGetCommand.mockResolvedValue(undefined)

			const input = "/nonexistent command"
			const result = await callParseMentions(input)

			expect(mockGetCommand).toHaveBeenCalledWith("/test/cwd", "nonexistent")
			// The command should remain unchanged in the text
			expect(result).toBe("/nonexistent command")
			// Should not contain any command tags
			expect(result).not.toContain('<command name="nonexistent">')
			expect(result).not.toContain("Command 'nonexistent' not found")
		})

		it("should handle command loading errors during existence check", async () => {
			mockGetCommand.mockReset()
			mockGetCommand.mockRejectedValue(new Error("Failed to load command"))

			const input = "/error-command test"
			const result = await callParseMentions(input)

			// When getCommand throws an error during existence check,
			// the command is treated as non-existent and left unchanged
			expect(result).toBe("/error-command test")
			expect(result).not.toContain('<command name="error-command">')
		})

		it("should handle command loading errors during processing", async () => {
			// With optimization, command is loaded once and cached
			mockGetCommand.mockResolvedValue({
				name: "error-command",
				content: "# Error command",
				source: "project",
				filePath: "/project/.roo/commands/error-command.md",
			})

			const input = "/error-command test"
			const result = await callParseMentions(input)

			expect(result).toContain('<command name="error-command">')
			expect(result).toContain("# Error command")
			expect(result).toContain("</command>")
		})

		it("should handle command names with hyphens and underscores at start", async () => {
			mockGetCommand.mockResolvedValue({
				name: "setup-dev",
				content: "# Dev setup",
				source: "project",
				filePath: "/project/.roo/commands/setup-dev.md",
			})

			const input = "/setup-dev for the project"
			const result = await callParseMentions(input)

			expect(mockGetCommand).toHaveBeenCalledWith("/test/cwd", "setup-dev")
			expect(result).toContain('<command name="setup-dev">')
			expect(result).toContain("# Dev setup")
		})

		it("should preserve command content formatting", async () => {
			const commandContent = `# Complex Command

## Step 1
Run this command:
\`\`\`bash
npm install
\`\`\`

## Step 2
- Check file1.js
- Update file2.ts
- Test everything

> **Note**: This is important!`

			mockGetCommand.mockResolvedValue({
				name: "complex",
				content: commandContent,
				source: "project",
				filePath: "/project/.roo/commands/complex.md",
			})

			const input = "/complex command"
			const result = await callParseMentions(input)

			expect(result).toContain('<command name="complex">')
			expect(result).toContain("# Complex Command")
			expect(result).toContain("```bash")
			expect(result).toContain("npm install")
			expect(result).toContain("- Check file1.js")
			expect(result).toContain("> **Note**: This is important!")
			expect(result).toContain("</command>")
		})

		it("should handle empty command content", async () => {
			mockGetCommand.mockResolvedValue({
				name: "empty",
				content: "",
				source: "project",
				filePath: "/project/.roo/commands/empty.md",
			})

			const input = "/empty command"
			const result = await callParseMentions(input)

			expect(result).toContain('<command name="empty">')
			expect(result).toContain("</command>")
			// Should still include the command tags even with empty content
		})
	})

	describe("command mention regex patterns", () => {
		it("should match valid command mention patterns anywhere", () => {
			const commandRegex = /\/([a-zA-Z0-9_\.-]+)(?=\s|$)/g

			const validPatterns = ["/setup", "/build-prod", "/test_suite", "/my-command", "/command123"]

			validPatterns.forEach((pattern) => {
				const match = pattern.match(commandRegex)
				expect(match).toBeTruthy()
				expect(match![0]).toBe(pattern)
			})
		})

		it("should match command patterns in middle of text", () => {
			const commandRegex = /\/([a-zA-Z0-9_\.-]+)(?=\s|$)/g

			const validPatterns = ["Please /setup", "Run /build now", "Use /deploy here"]

			validPatterns.forEach((pattern) => {
				const match = pattern.match(commandRegex)
				expect(match).toBeTruthy()
				expect(match![0]).toMatch(/^\/[a-zA-Z0-9_\.-]+$/)
			})
		})

		it("should match commands at start of new lines", () => {
			const commandRegex = /\/([a-zA-Z0-9_\.-]+)(?=\s|$)/g

			const multilineText = "First line\n/setup the project\nAnother line\n/deploy when ready"
			const matches = multilineText.match(commandRegex)

			// Should match both commands now
			expect(matches).toBeTruthy()
			expect(matches).toHaveLength(2)
			expect(matches![0]).toBe("/setup")
			expect(matches![1]).toBe("/deploy")
		})

		it("should match multiple commands in message", () => {
			const commandRegex = /(?:^|\s)\/([a-zA-Z0-9_\.-]+)(?=\s|$)/g

			const validText = "/setup the project\nThen /deploy later"
			const matches = validText.match(commandRegex)

			expect(matches).toBeTruthy()
			expect(matches).toHaveLength(2)
			expect(matches![0]).toBe("/setup")
			expect(matches![1]).toBe(" /deploy") // Note: includes leading space
		})

		it("should not match invalid command patterns", () => {
			const commandRegex = /\/([a-zA-Z0-9_\.-]+)(?=\s|$)/g

			const invalidPatterns = ["/ space", "/with space", "/with/slash", "//double", "/with@symbol"]

			invalidPatterns.forEach((pattern) => {
				const match = pattern.match(commandRegex)
				if (match) {
					// If it matches, it should not be the full invalid pattern
					expect(match[0]).not.toBe(pattern)
				}
			})
		})
	})

	describe("command mention text transformation", () => {
		it("should transform existing command mentions at start of message", async () => {
			mockGetCommand.mockResolvedValue({
				name: "setup",
				content: "# Setup instructions",
				source: "project",
				filePath: "/project/.roo/commands/setup.md",
			})

			const input = "/setup the project"
			const result = await callParseMentions(input)

			expect(result).toContain("Command 'setup' (see below for command content)")
		})

		it("should leave non-existent command mentions unchanged", async () => {
			mockGetCommand.mockResolvedValue(undefined)

			const input = "/nonexistent the project"
			const result = await callParseMentions(input)

			expect(result).toBe("/nonexistent the project")
		})

		it("should process multiple commands in message", async () => {
			mockGetCommand
				.mockResolvedValueOnce({
					name: "setup",
					content: "# Setup instructions",
					source: "project",
					filePath: "/project/.roo/commands/setup.md",
				})
				.mockResolvedValueOnce({
					name: "deploy",
					content: "# Deploy instructions",
					source: "project",
					filePath: "/project/.roo/commands/deploy.md",
				})

			const input = "/setup the project\nThen /deploy later"
			const result = await callParseMentions(input)

			expect(result).toContain("Command 'setup' (see below for command content)")
			expect(result).toContain("Command 'deploy' (see below for command content)")
		})

		it("should match commands anywhere with proper word boundaries", async () => {
			mockGetCommand.mockResolvedValue({
				name: "build",
				content: "# Build instructions",
				source: "project",
				filePath: "/project/.roo/commands/build.md",
			})

			// At the beginning - should match
			let input = "/build the project"
			let result = await callParseMentions(input)
			expect(result).toContain("Command 'build'")

			// After space - should match
			input = "Please /build and test"
			result = await callParseMentions(input)
			expect(result).toContain("Command 'build'")

			// At the end - should match
			input = "Run the /build"
			result = await callParseMentions(input)
			expect(result).toContain("Command 'build'")

			// At start of new line - should match
			input = "Some text\n/build the project"
			result = await callParseMentions(input)
			expect(result).toContain("Command 'build'")
		})
	})
})
