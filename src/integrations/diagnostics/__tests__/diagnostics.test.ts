import * as vscode from "vscode"
import { diagnosticsToProblemsString } from ".."

// Mock path module
jest.mock("path", () => ({
	relative: jest.fn((cwd, fullPath) => {
		// Handle the specific case already present
		if (cwd === "/project/root" && fullPath === "/project/root/src/utils/file.ts") {
			return "src/utils/file.ts"
		}
		// Handle the test cases with /path/to as cwd
		if (cwd === "/path/to") {
			// Simple relative path calculation for the test cases
			return fullPath.replace(cwd + "/", "")
		}
		// Fallback for other cases (can be adjusted if needed)
		return fullPath
	}),
}))

// Mock vscode module
jest.mock("vscode", () => ({
	Uri: {
		file: jest.fn((path) => ({
			fsPath: path,
			toString: jest.fn(() => path),
		})),
	},
	Diagnostic: jest.fn().mockImplementation((range, message, severity) => ({
		range,
		message,
		severity,
		source: "test",
	})),
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
	FileType: {
		Unknown: 0,
		File: 1,
		Directory: 2,
		SymbolicLink: 64,
	},
	workspace: {
		fs: {
			stat: jest.fn(),
		},
		openTextDocument: jest.fn(),
	},
}))

describe("diagnosticsToProblemsString", () => {
	beforeEach(() => {
		jest.clearAllMocks()
	})

	it("should filter diagnostics by severity and include correct labels", async () => {
		// Mock file URI
		const fileUri = vscode.Uri.file("/path/to/file.ts")

		// Create diagnostics with different severities
		const diagnostics = [
			new vscode.Diagnostic(new vscode.Range(0, 0, 0, 10), "Error message", vscode.DiagnosticSeverity.Error),
			new vscode.Diagnostic(new vscode.Range(1, 0, 1, 10), "Warning message", vscode.DiagnosticSeverity.Warning),
			new vscode.Diagnostic(new vscode.Range(2, 0, 2, 10), "Info message", vscode.DiagnosticSeverity.Information),
			new vscode.Diagnostic(new vscode.Range(3, 0, 3, 10), "Hint message", vscode.DiagnosticSeverity.Hint),
		]

		// Mock fs.stat to return file type
		const mockStat = {
			type: vscode.FileType.File,
		}
		vscode.workspace.fs.stat = jest.fn().mockResolvedValue(mockStat)

		// Mock document content
		const mockDocument = {
			lineAt: jest.fn((line) => ({
				text: `Line ${line + 1} content`,
			})),
		}
		vscode.workspace.openTextDocument = jest.fn().mockResolvedValue(mockDocument)

		// Test with Error and Warning severities only
		const result = await diagnosticsToProblemsString(
			[[fileUri, diagnostics]],
			[vscode.DiagnosticSeverity.Error, vscode.DiagnosticSeverity.Warning],
			"/path/to",
		)

		// Verify only Error and Warning diagnostics are included
		expect(result).toContain("Error message")
		expect(result).toContain("Warning message")
		expect(result).not.toContain("Info message")
		expect(result).not.toContain("Hint message")

		// Verify correct severity labels are used
		expect(result).toContain("[test Error]")
		expect(result).toContain("[test Warning]")
		expect(result).not.toContain("[test Information]")
		expect(result).not.toContain("[test Hint]")

		// Verify line content is included
		expect(result).toContain("Line 1 content")
		expect(result).toContain("Line 2 content")
	})

	it("should handle directory URIs correctly without attempting to open as document", async () => {
		// Mock directory URI
		const dirUri = vscode.Uri.file("/path/to/directory/")

		// Mock diagnostic for directory
		const diagnostic = new vscode.Diagnostic(
			new vscode.Range(0, 0, 0, 10),
			"Directory diagnostic message",
			vscode.DiagnosticSeverity.Error,
		)

		// Mock fs.stat to return directory type
		const mockStat = {
			type: vscode.FileType.Directory,
		}
		vscode.workspace.fs.stat = jest.fn().mockResolvedValue(mockStat)

		// Mock openTextDocument to ensure it's not called
		vscode.workspace.openTextDocument = jest.fn()

		// Call the function
		const result = await diagnosticsToProblemsString(
			[[dirUri, [diagnostic]]],
			[vscode.DiagnosticSeverity.Error],
			"/path/to",
		)

		// Verify fs.stat was called with the directory URI
		expect(vscode.workspace.fs.stat).toHaveBeenCalledWith(dirUri)

		// Verify openTextDocument was not called
		expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled()

		// Verify the output contains the expected directory indicator
		expect(result).toContain("(directory)")
		expect(result).toContain("Directory diagnostic message")
		expect(result).toMatch(/directory\/\n- \[test Error\] 1 \| \(directory\) : Directory diagnostic message/)
	})

	it("should correctly handle multiple diagnostics for the same file", async () => {
		// Mock file URI
		const fileUri = vscode.Uri.file("/path/to/file.ts")

		// Create multiple diagnostics for the same file
		const diagnostics = [
			new vscode.Diagnostic(new vscode.Range(4, 0, 4, 10), "Later line error", vscode.DiagnosticSeverity.Error),
			new vscode.Diagnostic(
				new vscode.Range(0, 0, 0, 10),
				"First line warning",
				vscode.DiagnosticSeverity.Warning,
			),
			new vscode.Diagnostic(
				new vscode.Range(2, 0, 2, 10),
				"Middle line info",
				vscode.DiagnosticSeverity.Information,
			),
		]

		// Mock fs.stat to return file type
		const mockStat = {
			type: vscode.FileType.File,
		}
		vscode.workspace.fs.stat = jest.fn().mockResolvedValue(mockStat)

		// Mock document content with specific line texts for each test case
		const mockDocument = {
			lineAt: jest.fn((line: number) => {
				const lineTexts: Record<number, string> = {
					0: "Line 0 content for warning",
					2: "Line 2 content for info",
					4: "Line 4 content for error",
				}
				return { text: lineTexts[line] }
			}),
		}
		vscode.workspace.openTextDocument = jest.fn().mockResolvedValue(mockDocument)

		// Call the function with all severities
		const result = await diagnosticsToProblemsString(
			[[fileUri, diagnostics]],
			[vscode.DiagnosticSeverity.Error, vscode.DiagnosticSeverity.Warning, vscode.DiagnosticSeverity.Information],
			"/path/to",
		)

		// Verify all diagnostics are included in the output
		expect(result).toContain("First line warning")
		expect(result).toContain("Middle line info")
		expect(result).toContain("Later line error")

		// Verify line content is included for each diagnostic and matches the test case
		expect(result).toContain("Line 0 content for warning")
		expect(result).toContain("Line 2 content for info")
		expect(result).toContain("Line 4 content for error")

		// Verify the output contains all severity labels
		expect(result).toContain("[test Warning]")
		expect(result).toContain("[test Information]")
		expect(result).toContain("[test Error]")

		// Verify diagnostics appear in line number order (even though input wasn't sorted)
		// Verify exact output format
		expect(result).toBe(
			"file.ts\n" +
				"- [test Warning] 1 | Line 0 content for warning : First line warning\n" +
				"- [test Information] 3 | Line 2 content for info : Middle line info\n" +
				"- [test Error] 5 | Line 4 content for error : Later line error",
		)
	})

	it("should correctly handle diagnostics from multiple files", async () => {
		// Mock URIs for different files
		const fileUri1 = vscode.Uri.file("/path/to/file1.ts")
		const fileUri2 = vscode.Uri.file("/path/to/subdir/file2.ts")

		// Create diagnostics for each file
		const diagnostics1 = [
			new vscode.Diagnostic(new vscode.Range(0, 0, 0, 10), "File1 error", vscode.DiagnosticSeverity.Error),
		]

		const diagnostics2 = [
			new vscode.Diagnostic(new vscode.Range(1, 0, 1, 10), "File2 warning", vscode.DiagnosticSeverity.Warning),
			new vscode.Diagnostic(new vscode.Range(2, 0, 2, 10), "File2 info", vscode.DiagnosticSeverity.Information),
		]

		// Mock fs.stat to return file type for both files
		const mockStat = {
			type: vscode.FileType.File,
		}
		vscode.workspace.fs.stat = jest.fn().mockResolvedValue(mockStat)

		// Mock document content with specific line texts for each test case
		const mockDocument1 = {
			lineAt: jest.fn((_line) => ({
				text: "Line 1 content for error",
			})),
		}
		const mockDocument2 = {
			lineAt: jest.fn((line) => {
				const lineTexts = ["Line 1 content", "Line 2 content for warning", "Line 3 content for info"]
				return { text: lineTexts[line] }
			}),
		}
		vscode.workspace.openTextDocument = jest
			.fn()
			.mockResolvedValueOnce(mockDocument1)
			.mockResolvedValueOnce(mockDocument2)

		// Call the function with all severities
		const result = await diagnosticsToProblemsString(
			[
				[fileUri1, diagnostics1],
				[fileUri2, diagnostics2],
			],
			[vscode.DiagnosticSeverity.Error, vscode.DiagnosticSeverity.Warning, vscode.DiagnosticSeverity.Information],
			"/path/to",
		)

		// Verify file paths are correctly shown with relative paths
		expect(result).toContain("file1.ts")
		expect(result).toContain("subdir/file2.ts")

		// Verify diagnostics are grouped under their respective files
		const file1Section = result.split("file1.ts")[1]
		expect(file1Section).toContain("File1 error")
		expect(file1Section).toContain("Line 1 content for error")

		const file2Section = result.split("subdir/file2.ts")[1]
		expect(file2Section).toContain("File2 warning")
		expect(file2Section).toContain("Line 2 content for warning")
		expect(file2Section).toContain("File2 info")
		expect(file2Section).toContain("Line 3 content for info")

		// Verify exact output format
		expect(result).toBe(
			"file1.ts\n" +
				"- [test Error] 1 | Line 1 content for error : File1 error\n\n" +
				"subdir/file2.ts\n" +
				"- [test Warning] 2 | Line 2 content for warning : File2 warning\n" +
				"- [test Information] 3 | Line 3 content for info : File2 info",
		)
	})

	it("should return empty string when no diagnostics match the severity filter", async () => {
		// Mock file URI
		const fileUri = vscode.Uri.file("/path/to/file.ts")

		// Create diagnostics with Error and Warning severities
		const diagnostics = [
			new vscode.Diagnostic(new vscode.Range(0, 0, 0, 10), "Error message", vscode.DiagnosticSeverity.Error),
			new vscode.Diagnostic(new vscode.Range(1, 0, 1, 10), "Warning message", vscode.DiagnosticSeverity.Warning),
		]

		// Mock fs.stat to return file type
		const mockStat = {
			type: vscode.FileType.File,
		}
		vscode.workspace.fs.stat = jest.fn().mockResolvedValue(mockStat)

		// Mock document content (though it shouldn't be accessed in this case)
		const mockDocument = {
			lineAt: jest.fn((line) => ({
				text: `Line ${line + 1} content`,
			})),
		}
		vscode.workspace.openTextDocument = jest.fn().mockResolvedValue(mockDocument)

		// Test with Information and Hint severities only (which don't match our diagnostics)
		const result = await diagnosticsToProblemsString(
			[[fileUri, diagnostics]],
			[vscode.DiagnosticSeverity.Information, vscode.DiagnosticSeverity.Hint],
			"/path/to",
		)

		// Verify empty string is returned
		expect(result).toBe("")

		// Verify no unnecessary calls were made
		expect(vscode.workspace.fs.stat).not.toHaveBeenCalled()
		expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled()
	})

	it("should correctly handle cwd parameter for relative file paths", async () => {
		// Mock file URI in a subdirectory
		const fileUri = vscode.Uri.file("/project/root/src/utils/file.ts")

		// Create a diagnostic for the file
		const diagnostic = new vscode.Diagnostic(
			new vscode.Range(4, 0, 4, 10),
			"Relative path test error",
			vscode.DiagnosticSeverity.Error,
		)

		// Mock fs.stat to return file type
		const mockStat = {
			type: vscode.FileType.File,
		}
		vscode.workspace.fs.stat = jest.fn().mockResolvedValue(mockStat)

		// Mock document content matching test assertion
		const mockDocument = {
			lineAt: jest.fn((line) => ({
				text: `Line ${line + 1} content for error`,
			})),
		}
		vscode.workspace.openTextDocument = jest.fn().mockResolvedValue(mockDocument)

		// Call the function with cwd set to the project root
		const result = await diagnosticsToProblemsString(
			[[fileUri, [diagnostic]]],
			[vscode.DiagnosticSeverity.Error],
			"/project/root",
		)

		// Verify exact output format
		expect(result).toBe(
			"src/utils/file.ts\n" + "- [test Error] 5 | Line 5 content for error : Relative path test error",
		)

		// Verify fs.stat and openTextDocument were called
		expect(vscode.workspace.fs.stat).toHaveBeenCalledWith(fileUri)
		expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith(fileUri)
	})
})
