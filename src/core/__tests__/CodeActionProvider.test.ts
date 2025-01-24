import * as vscode from "vscode"
import { CodeActionProvider } from "../CodeActionProvider"

// Mock VSCode API
jest.mock("vscode", () => ({
	CodeAction: jest.fn().mockImplementation((title, kind) => ({
		title,
		kind,
		command: undefined,
	})),
	CodeActionKind: {
		QuickFix: { value: "quickfix" },
		RefactorRewrite: { value: "refactor.rewrite" },
	},
	Range: jest.fn().mockImplementation((startLine, startChar, endLine, endChar) => ({
		start: { line: startLine, character: startChar },
		end: { line: endLine, character: endChar },
	})),
	Position: jest.fn().mockImplementation((line, character) => ({
		line,
		character,
	})),
	workspace: {
		getWorkspaceFolder: jest.fn(),
	},
	DiagnosticSeverity: {
		Error: 0,
		Warning: 1,
		Information: 2,
		Hint: 3,
	},
}))

describe("CodeActionProvider", () => {
	let provider: CodeActionProvider
	let mockDocument: any
	let mockRange: any
	let mockContext: any

	beforeEach(() => {
		provider = new CodeActionProvider()

		// Mock document
		mockDocument = {
			getText: jest.fn(),
			lineAt: jest.fn(),
			lineCount: 10,
			uri: { fsPath: "/test/file.ts" },
		}

		// Mock range
		mockRange = new vscode.Range(0, 0, 0, 10)

		// Mock context
		mockContext = {
			diagnostics: [],
		}
	})

	describe("getEffectiveRange", () => {
		it("should return selected text when available", () => {
			mockDocument.getText.mockReturnValue("selected text")

			const result = (provider as any).getEffectiveRange(mockDocument, mockRange)

			expect(result).toEqual({
				range: mockRange,
				text: "selected text",
			})
		})

		it("should return null for empty line", () => {
			mockDocument.getText.mockReturnValue("")
			mockDocument.lineAt.mockReturnValue({ text: "", lineNumber: 0 })

			const result = (provider as any).getEffectiveRange(mockDocument, mockRange)

			expect(result).toBeNull()
		})
	})

	describe("getFilePath", () => {
		it("should return relative path when in workspace", () => {
			const mockWorkspaceFolder = {
				uri: { fsPath: "/test" },
			}
			;(vscode.workspace.getWorkspaceFolder as jest.Mock).mockReturnValue(mockWorkspaceFolder)

			const result = (provider as any).getFilePath(mockDocument)

			expect(result).toBe("file.ts")
		})

		it("should return absolute path when not in workspace", () => {
			;(vscode.workspace.getWorkspaceFolder as jest.Mock).mockReturnValue(null)

			const result = (provider as any).getFilePath(mockDocument)

			expect(result).toBe("/test/file.ts")
		})
	})

	describe("provideCodeActions", () => {
		beforeEach(() => {
			mockDocument.getText.mockReturnValue("test code")
			mockDocument.lineAt.mockReturnValue({ text: "test code", lineNumber: 0 })
		})

		it("should provide explain and improve actions by default", () => {
			const actions = provider.provideCodeActions(mockDocument, mockRange, mockContext)

			expect(actions).toHaveLength(2)
			expect((actions as any)[0].title).toBe("Roo Code: Explain Code")
			expect((actions as any)[1].title).toBe("Roo Code: Improve Code")
		})

		it("should provide fix action when diagnostics exist", () => {
			mockContext.diagnostics = [
				{
					message: "test error",
					severity: vscode.DiagnosticSeverity.Error,
					range: mockRange,
				},
			]

			const actions = provider.provideCodeActions(mockDocument, mockRange, mockContext)

			expect(actions).toHaveLength(3)
			expect((actions as any).some((a: any) => a.title === "Roo Code: Fix Code")).toBe(true)
		})

		it("should handle errors gracefully", () => {
			const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {})
			mockDocument.getText.mockImplementation(() => {
				throw new Error("Test error")
			})
			mockDocument.lineAt.mockReturnValue({ text: "test", lineNumber: 0 })

			const actions = provider.provideCodeActions(mockDocument, mockRange, mockContext)

			expect(actions).toEqual([])
			expect(consoleErrorSpy).toHaveBeenCalledWith("Error getting effective range:", expect.any(Error))

			consoleErrorSpy.mockRestore()
		})
	})
})
