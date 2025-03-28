import * as vscode from "vscode"
import { CodeActionProvider, ACTION_NAMES } from "../CodeActionProvider"
import { EditorUtils } from "../EditorUtils"

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
	DiagnosticSeverity: {
		Error: 0,
		Warning: 1,
		Information: 2,
		Hint: 3,
	},
}))

// Mock EditorUtils
jest.mock("../EditorUtils", () => ({
	EditorUtils: {
		getEffectiveRange: jest.fn(),
		getFilePath: jest.fn(),
		hasIntersectingRange: jest.fn(),
		createDiagnosticData: jest.fn(),
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

		// Setup default EditorUtils mocks
		;(EditorUtils.getEffectiveRange as jest.Mock).mockReturnValue({
			range: mockRange,
			text: "test code",
		})
		;(EditorUtils.getFilePath as jest.Mock).mockReturnValue("/test/file.ts")
		;(EditorUtils.hasIntersectingRange as jest.Mock).mockReturnValue(true)
		;(EditorUtils.createDiagnosticData as jest.Mock).mockImplementation((d) => d)
	})

	describe("provideCodeActions", () => {
		it("should provide explain, improve, fix logic, and add to context actions by default", () => {
			const actions = provider.provideCodeActions(mockDocument, mockRange, mockContext)

			expect(actions).toHaveLength(7) // 2 explain + 2 fix logic + 2 improve + 1 add to context
			expect((actions as any)[0].title).toBe(ACTION_NAMES.ADD_TO_CONTEXT)
			expect((actions as any)[1].title).toBe(`${ACTION_NAMES.EXPLAIN} in New Task`)
			expect((actions as any)[2].title).toBe(`${ACTION_NAMES.EXPLAIN} in Current Task`)
			expect((actions as any)[3].title).toBe(`${ACTION_NAMES.FIX_LOGIC} in New Task`)
			expect((actions as any)[4].title).toBe(`${ACTION_NAMES.FIX_LOGIC} in Current Task`)
			expect((actions as any)[5].title).toBe(`${ACTION_NAMES.IMPROVE} in New Task`)
			expect((actions as any)[6].title).toBe(`${ACTION_NAMES.IMPROVE} in Current Task`)
		})

		it("should provide fix action instead of fix logic when diagnostics exist", () => {
			mockContext.diagnostics = [
				{
					message: "test error",
					severity: vscode.DiagnosticSeverity.Error,
					range: mockRange,
				},
			]

			const actions = provider.provideCodeActions(mockDocument, mockRange, mockContext)

			expect(actions).toHaveLength(7) // 2 explain + 2 fix + 2 improve + 1 add to context
			expect((actions as any).some((a: any) => a.title === `${ACTION_NAMES.FIX} in New Task`)).toBe(true)
			expect((actions as any).some((a: any) => a.title === `${ACTION_NAMES.FIX} in Current Task`)).toBe(true)
			expect((actions as any).some((a: any) => a.title === `${ACTION_NAMES.FIX_LOGIC} in New Task`)).toBe(false)
			expect((actions as any).some((a: any) => a.title === `${ACTION_NAMES.FIX_LOGIC} in Current Task`)).toBe(
				false,
			)
		})

		it("should return empty array when no effective range", () => {
			;(EditorUtils.getEffectiveRange as jest.Mock).mockReturnValue(null)

			const actions = provider.provideCodeActions(mockDocument, mockRange, mockContext)

			expect(actions).toEqual([])
		})

		it("should handle errors gracefully", () => {
			const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {})
			;(EditorUtils.getEffectiveRange as jest.Mock).mockImplementation(() => {
				throw new Error("Test error")
			})

			const actions = provider.provideCodeActions(mockDocument, mockRange, mockContext)

			expect(actions).toEqual([])
			expect(consoleErrorSpy).toHaveBeenCalledWith("Error providing code actions:", expect.any(Error))

			consoleErrorSpy.mockRestore()
		})
	})
})
