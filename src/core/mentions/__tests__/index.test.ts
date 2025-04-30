// Create mock vscode module before importing anything
const createMockUri = (scheme: string, path: string) => ({
	scheme,
	authority: "",
	path,
	query: "",
	fragment: "",
	fsPath: path,
	with: jest.fn(),
	toString: () => path,
	toJSON: () => ({
		scheme,
		authority: "",
		path,
		query: "",
		fragment: "",
	}),
})

const mockExecuteCommand = jest.fn()
const mockOpenExternal = jest.fn()
const mockShowErrorMessage = jest.fn()

const mockVscode = {
	workspace: {
		workspaceFolders: [
			{
				uri: { fsPath: "/test/workspace" },
			},
		] as { uri: { fsPath: string } }[] | undefined,
		getWorkspaceFolder: jest.fn().mockReturnValue("/test/workspace"),
		fs: {
			stat: jest.fn(),
			writeFile: jest.fn(),
		},
		openTextDocument: jest.fn().mockResolvedValue({}),
	},
	window: {
		showErrorMessage: mockShowErrorMessage,
		showInformationMessage: jest.fn(),
		showWarningMessage: jest.fn(),
		createTextEditorDecorationType: jest.fn(),
		createOutputChannel: jest.fn(),
		createWebviewPanel: jest.fn(),
		showTextDocument: jest.fn().mockResolvedValue({}),
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
		parse: jest.fn((url: string) => createMockUri("https", url)),
		file: jest.fn((path: string) => createMockUri("file", path)),
	},
	Position: jest.fn(),
	Range: jest.fn(),
	TextEdit: jest.fn(),
	WorkspaceEdit: jest.fn(),
	DiagnosticSeverity: {
		Error: 0,
		Warning: 1,
		Information: 2,
		Hint: 3,
	},
}

// Mock modules
jest.mock("vscode", () => mockVscode)
jest.mock("../../../services/browser/UrlContentFetcher")
jest.mock("../../../utils/git")
jest.mock("../../../utils/path")

// Now import the modules that use the mocks
import { parseMentions, openMention } from "../index"
import { UrlContentFetcher } from "../../../services/browser/UrlContentFetcher"
import * as git from "../../../utils/git"

import { getWorkspacePath } from "../../../utils/path"
;(getWorkspacePath as jest.Mock).mockReturnValue("/test/workspace")

jest.mock("fs/promises", () => ({
	stat: jest.fn(),
	readdir: jest.fn(),
}))
import fs from "fs/promises"
import * as path from "path"

jest.mock("../../../integrations/misc/open-file", () => ({
	openFile: jest.fn(),
}))
import { openFile } from "../../../integrations/misc/open-file"

jest.mock("../../../integrations/misc/extract-text", () => ({
	extractTextFromFile: jest.fn(),
}))

import * as vscode from "vscode"

describe("mentions", () => {
	const mockCwd = "/test/workspace"
	let mockUrlContentFetcher: UrlContentFetcher

	beforeEach(() => {
		jest.clearAllMocks()

		// Create a mock instance with just the methods we need
		mockUrlContentFetcher = {
			launchBrowser: jest.fn().mockResolvedValue(undefined),
			closeBrowser: jest.fn().mockResolvedValue(undefined),
			urlToMarkdown: jest.fn().mockResolvedValue(""),
		} as unknown as UrlContentFetcher

		// Reset all vscode mocks
		mockVscode.workspace.fs.stat.mockReset()
		mockVscode.workspace.fs.writeFile.mockReset()
		mockVscode.workspace.openTextDocument.mockReset().mockResolvedValue({})
		mockVscode.window.showTextDocument.mockReset().mockResolvedValue({})
		mockVscode.window.showErrorMessage.mockReset()
		mockExecuteCommand.mockReset()
		mockOpenExternal.mockReset()
	})

	describe("parseMentions", () => {
		let mockUrlFetcher: UrlContentFetcher

		beforeEach(() => {
			mockUrlFetcher = new (UrlContentFetcher as jest.Mock<UrlContentFetcher>)()
			;(fs.stat as jest.Mock).mockResolvedValue({ isFile: () => true, isDirectory: () => false })
			;(require("../../../integrations/misc/extract-text").extractTextFromFile as jest.Mock).mockResolvedValue(
				"Mock file content",
			)
		})

		it("should parse git commit mentions", async () => {
			const commitHash = "abc1234"
			const commitInfo = `abc1234 Fix bug in parser

Author: John Doe
Date: Mon Jan 5 23:50:06 2025 -0500

Detailed commit message with multiple lines
- Fixed parsing issue
- Added tests`

			jest.mocked(git.getCommitInfo).mockResolvedValue(commitInfo)

			const result = await parseMentions(`Check out this commit @${commitHash}`, mockCwd, mockUrlContentFetcher)

			expect(result).toContain(`'${commitHash}' (see below for commit info)`)
			expect(result).toContain(`<git_commit hash="${commitHash}">`)
			expect(result).toContain(commitInfo)
		})

		it("should handle errors fetching git info", async () => {
			const commitHash = "abc1234"
			const errorMessage = "Failed to get commit info"

			jest.mocked(git.getCommitInfo).mockRejectedValue(new Error(errorMessage))

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
			expect(require("../../../integrations/misc/extract-text").extractTextFromFile).toHaveBeenCalledWith(
				expectedAbsPath,
			)

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
			;(fs.stat as jest.Mock).mockResolvedValue({ isFile: () => false, isDirectory: () => true })
			;(fs.readdir as jest.Mock).mockResolvedValue([]) // Empty directory

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
			;(fs.stat as jest.Mock).mockRejectedValue(mockError)

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
			;(getWorkspacePath as jest.Mock).mockReturnValue(mockCwd)
		})

		it("should handle URLs", async () => {
			const url = "https://example.com"
			await openMention(url)
			const mockUri = vscode.Uri.parse(url)
			expect(vscode.env.openExternal).toHaveBeenCalled()
			const calledArg = (vscode.env.openExternal as jest.Mock).mock.calls[0][0]
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
			;(vscode.Uri.file as jest.Mock).mockReturnValue(expectedUri)

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
			;(getWorkspacePath as jest.Mock).mockReturnValue(undefined)
			await openMention("/some\\ path.txt")
			expect(openFile).not.toHaveBeenCalled()
			expect(vscode.commands.executeCommand).not.toHaveBeenCalled()
		})
	})
})
