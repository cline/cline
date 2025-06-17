import type { Mock } from "vitest"

// Mock modules - must come before imports
vi.mock("vscode", () => {
	const createMockUri = (scheme: string, path: string) => ({
		scheme,
		authority: "",
		path,
		query: "",
		fragment: "",
		fsPath: path,
		with: vi.fn(),
		toString: () => path,
		toJSON: () => ({
			scheme,
			authority: "",
			path,
			query: "",
			fragment: "",
		}),
	})

	const mockExecuteCommand = vi.fn()
	const mockOpenExternal = vi.fn()
	const mockShowErrorMessage = vi.fn()

	return {
		workspace: {
			workspaceFolders: [
				{
					uri: { fsPath: "/test/workspace" },
				},
			] as { uri: { fsPath: string } }[] | undefined,
			getWorkspaceFolder: vi.fn().mockReturnValue("/test/workspace"),
			fs: {
				stat: vi.fn(),
				writeFile: vi.fn(),
			},
			openTextDocument: vi.fn().mockResolvedValue({}),
		},
		window: {
			showErrorMessage: mockShowErrorMessage,
			showInformationMessage: vi.fn(),
			showWarningMessage: vi.fn(),
			createTextEditorDecorationType: vi.fn(),
			createOutputChannel: vi.fn(),
			createWebviewPanel: vi.fn(),
			showTextDocument: vi.fn().mockResolvedValue({}),
			activeTextEditor: undefined as
				| undefined
				| {
						document: {
							uri: { fsPath: string }
						}
				  },
		},
		commands: {
			executeCommand: mockExecuteCommand,
		},
		env: {
			openExternal: mockOpenExternal,
		},
		Uri: {
			parse: vi.fn((url: string) => createMockUri("https", url)),
			file: vi.fn((path: string) => createMockUri("file", path)),
		},
		Position: vi.fn(),
		Range: vi.fn(),
		TextEdit: vi.fn(),
		WorkspaceEdit: vi.fn(),
		DiagnosticSeverity: {
			Error: 0,
			Warning: 1,
			Information: 2,
			Hint: 3,
		},
	}
})
vi.mock("../../../services/browser/UrlContentFetcher")
vi.mock("../../../utils/git")
vi.mock("../../../utils/path")
vi.mock("fs/promises", () => ({
	default: {
		stat: vi.fn(),
		readdir: vi.fn(),
	},
	stat: vi.fn(),
	readdir: vi.fn(),
}))
vi.mock("../../../integrations/misc/open-file", () => ({
	openFile: vi.fn(),
}))
vi.mock("../../../integrations/misc/extract-text", () => ({
	extractTextFromFile: vi.fn(),
}))

// Now import the modules that use the mocks
import { parseMentions, openMention } from "../index"
import { UrlContentFetcher } from "../../../services/browser/UrlContentFetcher"
import * as git from "../../../utils/git"
import { getWorkspacePath } from "../../../utils/path"
import fs from "fs/promises"
import * as path from "path"
import { openFile } from "../../../integrations/misc/open-file"
import { extractTextFromFile } from "../../../integrations/misc/extract-text"
import * as vscode from "vscode"
;(getWorkspacePath as Mock).mockReturnValue("/test/workspace")

describe("mentions", () => {
	const mockCwd = "/test/workspace"
	let mockUrlContentFetcher: UrlContentFetcher

	beforeEach(() => {
		vi.clearAllMocks()

		// Create a mock instance with just the methods we need
		mockUrlContentFetcher = {
			launchBrowser: vi.fn().mockResolvedValue(undefined),
			closeBrowser: vi.fn().mockResolvedValue(undefined),
			urlToMarkdown: vi.fn().mockResolvedValue(""),
		} as unknown as UrlContentFetcher

		// Reset all vscode mocks using vi.mocked
		vi.mocked(vscode.workspace.fs.stat).mockReset()
		vi.mocked(vscode.workspace.fs.writeFile).mockReset()
		vi.mocked(vscode.workspace.openTextDocument)
			.mockReset()
			.mockResolvedValue({} as any)
		vi.mocked(vscode.window.showTextDocument)
			.mockReset()
			.mockResolvedValue({} as any)
		vi.mocked(vscode.window.showErrorMessage).mockReset()
		vi.mocked(vscode.commands.executeCommand).mockReset()
		vi.mocked(vscode.env.openExternal).mockReset()
	})

	describe("parseMentions", () => {
		let mockUrlFetcher: UrlContentFetcher

		beforeEach(() => {
			mockUrlFetcher = new (UrlContentFetcher as any)()
			;(fs.stat as Mock).mockResolvedValue({ isFile: () => true, isDirectory: () => false })
			;(extractTextFromFile as Mock).mockResolvedValue("Mock file content")
		})

		it("should parse git commit mentions", async () => {
			const commitHash = "abc1234"
			const commitInfo = `abc1234 Fix bug in parser

Author: John Doe
Date: Mon Jan 5 23:50:06 2025 -0500

Detailed commit message with multiple lines
- Fixed parsing issue
- Added tests`

			vi.mocked(git.getCommitInfo).mockResolvedValue(commitInfo)

			const result = await parseMentions(`Check out this commit @${commitHash}`, mockCwd, mockUrlContentFetcher)

			expect(result).toContain(`'${commitHash}' (see below for commit info)`)
			expect(result).toContain(`<git_commit hash="${commitHash}">`)
			expect(result).toContain(commitInfo)
		})

		it("should handle errors fetching git info", async () => {
			const commitHash = "abc1234"
			const errorMessage = "Failed to get commit info"

			vi.mocked(git.getCommitInfo).mockRejectedValue(new Error(errorMessage))

			const result = await parseMentions(`Check out this commit @${commitHash}`, mockCwd, mockUrlContentFetcher)

			expect(result).toContain(`'${commitHash}' (see below for commit info)`)
			expect(result).toContain(`<git_commit hash="${commitHash}">`)
			expect(result).toContain(`Error fetching commit info: ${errorMessage}`)
		})

		it("should correctly parse mentions with escaped spaces and fetch content", async () => {
			const text = "Please check the file @/path/to/file\\ with\\ spaces.txt"
			const expectedUnescaped = "path/to/file with spaces.txt" // Note: leading '/' removed by slice(1) in parseMentions
			const expectedAbsPath = path.resolve(mockCwd, expectedUnescaped)

			const result = await parseMentions(text, mockCwd, mockUrlFetcher)

			// Check if fs.stat was called with the unescaped path
			expect(fs.stat).toHaveBeenCalledWith(expectedAbsPath)
			// Check if extractTextFromFile was called with the unescaped path
			expect(extractTextFromFile).toHaveBeenCalledWith(expectedAbsPath)

			// Check the output format
			expect(result).toContain(`'path/to/file\\ with\\ spaces.txt' (see below for file content)`)
			expect(result).toContain(
				`<file_content path="path/to/file\\ with\\ spaces.txt">\nMock file content\n</file_content>`,
			)
		})

		it("should handle folder mentions with escaped spaces", async () => {
			const text = "Look in @/my\\ documents/folder\\ name/"
			const expectedUnescaped = "my documents/folder name/"
			const expectedAbsPath = path.resolve(mockCwd, expectedUnescaped)
			;(fs.stat as Mock).mockResolvedValue({ isFile: () => false, isDirectory: () => true })
			;(fs.readdir as Mock).mockResolvedValue([]) // Empty directory

			const result = await parseMentions(text, mockCwd, mockUrlFetcher)

			expect(fs.stat).toHaveBeenCalledWith(expectedAbsPath)
			expect(fs.readdir).toHaveBeenCalledWith(expectedAbsPath, { withFileTypes: true })
			expect(result).toContain(`'my\\ documents/folder\\ name/' (see below for folder content)`)
			expect(result).toContain(`<folder_content path="my\\ documents/folder\\ name/">`) // Content check might be more complex
		})

		it("should handle errors when accessing paths with escaped spaces", async () => {
			const text = "Check @/nonexistent\\ file.txt"
			const expectedUnescaped = "nonexistent file.txt"
			const expectedAbsPath = path.resolve(mockCwd, expectedUnescaped)
			const mockError = new Error("ENOENT: no such file or directory")
			;(fs.stat as Mock).mockRejectedValue(mockError)

			const result = await parseMentions(text, mockCwd, mockUrlFetcher)

			expect(fs.stat).toHaveBeenCalledWith(expectedAbsPath)
			expect(result).toContain(
				`<file_content path="nonexistent\\ file.txt">\nError fetching content: Failed to access path "nonexistent\\ file.txt": ${mockError.message}\n</file_content>`,
			)
		})

		// Add more tests for parseMentions if needed (URLs, other mentions combined with escaped paths etc.)
	})

	describe("openMention", () => {
		beforeEach(() => {
			;(getWorkspacePath as Mock).mockReturnValue(mockCwd)
		})

		it("should handle URLs", async () => {
			const url = "https://example.com"
			await openMention(url)
			const mockUri = vscode.Uri.parse(url)
			expect(vscode.env.openExternal).toHaveBeenCalled()
			const calledArg = (vscode.env.openExternal as Mock).mock.calls[0][0]
			expect(calledArg).toEqual(
				expect.objectContaining({
					scheme: mockUri.scheme,
					authority: mockUri.authority,
					path: mockUri.path,
					query: mockUri.query,
					fragment: mockUri.fragment,
				}),
			)
		})

		it("should unescape file path before opening", async () => {
			const mention = "/file\\ with\\ spaces.txt"
			const expectedUnescaped = "file with spaces.txt"
			const expectedAbsPath = path.resolve(mockCwd, expectedUnescaped)

			await openMention(mention)

			expect(openFile).toHaveBeenCalledWith(expectedAbsPath)
			expect(vscode.commands.executeCommand).not.toHaveBeenCalled()
		})

		it("should unescape folder path before revealing", async () => {
			const mention = "/folder\\ with\\ spaces/"
			const expectedUnescaped = "folder with spaces/"
			const expectedAbsPath = path.resolve(mockCwd, expectedUnescaped)
			const expectedUri = { fsPath: expectedAbsPath } // From mock
			;(vscode.Uri.file as Mock).mockReturnValue(expectedUri)

			await openMention(mention)

			expect(vscode.commands.executeCommand).toHaveBeenCalledWith("revealInExplorer", expectedUri)
			expect(vscode.Uri.file).toHaveBeenCalledWith(expectedAbsPath)
			expect(openFile).not.toHaveBeenCalled()
		})

		it("should handle mentions without paths correctly", async () => {
			await openMention("problems")
			expect(vscode.commands.executeCommand).toHaveBeenCalledWith("workbench.actions.view.problems")

			await openMention("terminal")
			expect(vscode.commands.executeCommand).toHaveBeenCalledWith("workbench.action.terminal.focus")

			await openMention("http://example.com")
			expect(vscode.env.openExternal).toHaveBeenCalled() // Check if called, specific URI mock might be needed for detailed check

			await openMention("git-changes") // Assuming no specific action for this yet
			// Add expectations if an action is defined for git-changes

			await openMention("a1b2c3d") // Assuming no specific action for commit hashes yet
			// Add expectations if an action is defined for commit hashes
		})

		it("should do nothing if mention is undefined or empty", async () => {
			await openMention(undefined)
			await openMention("")
			expect(openFile).not.toHaveBeenCalled()
			expect(vscode.commands.executeCommand).not.toHaveBeenCalled()
			expect(vscode.env.openExternal).not.toHaveBeenCalled()
		})

		it("should do nothing if cwd is not available", async () => {
			;(getWorkspacePath as Mock).mockReturnValue(undefined)
			await openMention("/some\\ path.txt")
			expect(openFile).not.toHaveBeenCalled()
			expect(vscode.commands.executeCommand).not.toHaveBeenCalled()
		})
	})
})
