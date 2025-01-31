import * as vscode from "vscode"
import { EditorUtils } from "../EditorUtils"

// Mock VSCode API
jest.mock("vscode", () => ({
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
}))

describe("EditorUtils", () => {
	let mockDocument: any

	beforeEach(() => {
		mockDocument = {
			getText: jest.fn(),
			lineAt: jest.fn(),
			lineCount: 10,
			uri: { fsPath: "/test/file.ts" },
		}
	})

	describe("getEffectiveRange", () => {
		it("should return selected text when available", () => {
			const mockRange = new vscode.Range(0, 0, 0, 10)
			mockDocument.getText.mockReturnValue("selected text")

			const result = EditorUtils.getEffectiveRange(mockDocument, mockRange)

			expect(result).toEqual({
				range: mockRange,
				text: "selected text",
			})
		})

		it("should return null for empty line", () => {
			const mockRange = new vscode.Range(0, 0, 0, 10)
			mockDocument.getText.mockReturnValue("")
			mockDocument.lineAt.mockReturnValue({ text: "", lineNumber: 0 })

			const result = EditorUtils.getEffectiveRange(mockDocument, mockRange)

			expect(result).toBeNull()
		})
	})

	describe("getFilePath", () => {
		it("should return relative path when in workspace", () => {
			const mockWorkspaceFolder = {
				uri: { fsPath: "/test" },
			}
			;(vscode.workspace.getWorkspaceFolder as jest.Mock).mockReturnValue(mockWorkspaceFolder)

			const result = EditorUtils.getFilePath(mockDocument)

			expect(result).toBe("file.ts")
		})

		it("should return absolute path when not in workspace", () => {
			;(vscode.workspace.getWorkspaceFolder as jest.Mock).mockReturnValue(null)

			const result = EditorUtils.getFilePath(mockDocument)

			expect(result).toBe("/test/file.ts")
		})
	})
})
