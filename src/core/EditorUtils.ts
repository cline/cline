import * as vscode from "vscode"
import * as path from "path"

export interface EffectiveRange {
	range: vscode.Range
	text: string
}

export interface DiagnosticData {
	message: string
	severity: vscode.DiagnosticSeverity
	code?: string | number | { value: string | number; target: vscode.Uri }
	source?: string
	range: vscode.Range
}

export interface EditorContext {
	filePath: string
	selectedText: string
	diagnostics?: DiagnosticData[]
}

export class EditorUtils {
	// Cache file paths for performance
	private static readonly filePathCache = new WeakMap<vscode.TextDocument, string>()

	static getEffectiveRange(
		document: vscode.TextDocument,
		range: vscode.Range | vscode.Selection,
	): EffectiveRange | null {
		try {
			const selectedText = document.getText(range)
			if (selectedText) {
				return { range, text: selectedText }
			}

			const currentLine = document.lineAt(range.start.line)
			if (!currentLine.text.trim()) {
				return null
			}

			// Optimize range creation by checking bounds first
			const startLine = Math.max(0, currentLine.lineNumber - 1)
			const endLine = Math.min(document.lineCount - 1, currentLine.lineNumber + 1)

			// Only create new positions if needed
			const effectiveRange = new vscode.Range(
				startLine === currentLine.lineNumber ? range.start : new vscode.Position(startLine, 0),
				endLine === currentLine.lineNumber
					? range.end
					: new vscode.Position(endLine, document.lineAt(endLine).text.length),
			)

			return {
				range: effectiveRange,
				text: document.getText(effectiveRange),
			}
		} catch (error) {
			console.error("Error getting effective range:", error)
			return null
		}
	}

	static getFilePath(document: vscode.TextDocument): string {
		// Check cache first
		let filePath = this.filePathCache.get(document)
		if (filePath) {
			return filePath
		}

		try {
			const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)
			if (!workspaceFolder) {
				filePath = document.uri.fsPath
			} else {
				const relativePath = path.relative(workspaceFolder.uri.fsPath, document.uri.fsPath)
				filePath = !relativePath || relativePath.startsWith("..") ? document.uri.fsPath : relativePath
			}

			// Cache the result
			this.filePathCache.set(document, filePath)
			return filePath
		} catch (error) {
			console.error("Error getting file path:", error)
			return document.uri.fsPath
		}
	}

	static createDiagnosticData(diagnostic: vscode.Diagnostic): DiagnosticData {
		return {
			message: diagnostic.message,
			severity: diagnostic.severity,
			code: diagnostic.code,
			source: diagnostic.source,
			range: diagnostic.range,
		}
	}

	static hasIntersectingRange(range1: vscode.Range, range2: vscode.Range): boolean {
		return !(
			range2.end.line < range1.start.line ||
			range2.start.line > range1.end.line ||
			(range2.end.line === range1.start.line && range2.end.character < range1.start.character) ||
			(range2.start.line === range1.end.line && range2.start.character > range1.end.character)
		)
	}

	static getEditorContext(editor?: vscode.TextEditor): EditorContext | null {
		try {
			if (!editor) {
				editor = vscode.window.activeTextEditor
			}
			if (!editor) {
				return null
			}

			const document = editor.document
			const selection = editor.selection
			const effectiveRange = this.getEffectiveRange(document, selection)

			if (!effectiveRange) {
				return null
			}

			const filePath = this.getFilePath(document)
			const diagnostics = vscode.languages
				.getDiagnostics(document.uri)
				.filter((d) => this.hasIntersectingRange(effectiveRange.range, d.range))
				.map(this.createDiagnosticData)

			return {
				filePath,
				selectedText: effectiveRange.text,
				...(diagnostics.length > 0 ? { diagnostics } : {}),
			}
		} catch (error) {
			console.error("Error getting editor context:", error)
			return null
		}
	}
}
