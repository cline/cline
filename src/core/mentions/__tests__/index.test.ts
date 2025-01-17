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
		],
	},
	window: {
		showErrorMessage: mockShowErrorMessage,
		showInformationMessage: jest.fn(),
		showWarningMessage: jest.fn(),
		createTextEditorDecorationType: jest.fn(),
		createOutputChannel: jest.fn(),
		createWebviewPanel: jest.fn(),
		activeTextEditor: undefined,
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

// Now import the modules that use the mocks
import { parseMentions, openMention } from "../index"
import { UrlContentFetcher } from "../../../services/browser/UrlContentFetcher"
import * as git from "../../../utils/git"

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
	})

	describe("parseMentions", () => {
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
	})

	describe("openMention", () => {
		it("should handle file paths and problems", async () => {
			await openMention("/path/to/file")
			expect(mockExecuteCommand).not.toHaveBeenCalled()
			expect(mockOpenExternal).not.toHaveBeenCalled()
			expect(mockShowErrorMessage).toHaveBeenCalledWith("Could not open file: File does not exist")

			await openMention("problems")
			expect(mockExecuteCommand).toHaveBeenCalledWith("workbench.actions.view.problems")
		})

		it("should handle URLs", async () => {
			const url = "https://example.com"
			await openMention(url)
			const mockUri = mockVscode.Uri.parse(url)
			expect(mockOpenExternal).toHaveBeenCalled()
			const calledArg = mockOpenExternal.mock.calls[0][0]
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
	})
})
