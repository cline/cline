// npx jest src/integrations/editor/__tests__/EditorUtils.test.ts

import * as vscode from "vscode"

import { EditorUtils } from "../EditorUtils"

// Use simple classes to simulate VSCode's Range and Position behavior.
jest.mock("vscode", () => {
	class MockPosition {
		constructor(
			public line: number,
			public character: number,
		) {}
	}
	class MockRange {
		start: MockPosition
		end: MockPosition
		constructor(start: MockPosition, end: MockPosition) {
			this.start = start
			this.end = end
		}
	}

	return {
		Range: MockRange,
		Position: MockPosition,
		workspace: {
			getWorkspaceFolder: jest.fn(),
		},
		window: { activeTextEditor: undefined },
		languages: {
			getDiagnostics: jest.fn(() => []),
		},
	}
})

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
			const mockRange = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 10))
			mockDocument.getText.mockReturnValue("selected text")

			const result = EditorUtils.getEffectiveRange(mockDocument, mockRange)

			expect(result).toEqual({
				range: mockRange,
				text: "selected text",
			})
		})

		it("should return null for empty line", () => {
			const mockRange = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 10))
			mockDocument.getText.mockReturnValue("")
			mockDocument.lineAt.mockReturnValue({ text: "", lineNumber: 0 })

			const result = EditorUtils.getEffectiveRange(mockDocument, mockRange)

			expect(result).toBeNull()
		})

		it("should expand empty selection to full lines", () => {
			// Simulate a caret (empty selection) on line 2 at character 5.
			const initialRange = new vscode.Range(new vscode.Position(2, 5), new vscode.Position(2, 5))
			// Return non-empty text for any line with text (lines 1, 2, and 3).
			mockDocument.lineAt.mockImplementation((line: number) => {
				return { text: `Line ${line} text`, lineNumber: line }
			})
			mockDocument.getText.mockImplementation((range: any) => {
				// If the range is exactly the empty initial selection, return an empty string.
				if (
					range.start.line === initialRange.start.line &&
					range.start.character === initialRange.start.character &&
					range.end.line === initialRange.end.line &&
					range.end.character === initialRange.end.character
				) {
					return ""
				}
				return "expanded text"
			})

			const result = EditorUtils.getEffectiveRange(mockDocument, initialRange)

			expect(result).not.toBeNull()
			// Expected effective range: from the beginning of line 1 to the end of line 3.
			expect(result?.range.start).toEqual({ line: 1, character: 0 })
			expect(result?.range.end).toEqual({ line: 3, character: 11 })
			expect(result?.text).toBe("expanded text")
		})
	})

	describe("hasIntersectingRange", () => {
		it("should return false for ranges that only touch boundaries", () => {
			// Range1: [0, 0) - [0, 10) and Range2: [0, 10) - [0, 20)
			const range1 = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 10))
			const range2 = new vscode.Range(new vscode.Position(0, 10), new vscode.Position(0, 20))
			expect(EditorUtils.hasIntersectingRange(range1, range2)).toBe(false)
		})

		it("should return true for overlapping ranges", () => {
			// Range1: [0, 0) - [0, 15) and Range2: [0, 10) - [0, 20)
			const range1 = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 15))
			const range2 = new vscode.Range(new vscode.Position(0, 10), new vscode.Position(0, 20))
			expect(EditorUtils.hasIntersectingRange(range1, range2)).toBe(true)
		})

		it("should return false for non-overlapping ranges", () => {
			// Range1: [0, 0) - [0, 10) and Range2: [1, 0) - [1, 5)
			const range1 = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 10))
			const range2 = new vscode.Range(new vscode.Position(1, 0), new vscode.Position(1, 5))
			expect(EditorUtils.hasIntersectingRange(range1, range2)).toBe(false)
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
