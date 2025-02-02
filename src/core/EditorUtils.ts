import * as vscode from "vscode"
import * as path from "path"

/**
 * Represents an effective range in a document along with the corresponding text.
 */
export interface EffectiveRange {
	/** The range within the document. */
	range: vscode.Range
	/** The text within the specified range. */
	text: string
}

/**
 * Represents diagnostic information extracted from a VSCode diagnostic.
 */
export interface DiagnosticData {
	/** The diagnostic message. */
	message: string
	/** The severity level of the diagnostic. */
	severity: vscode.DiagnosticSeverity
	/**
	 * Optional diagnostic code.
	 * Can be a string, number, or an object with value and target.
	 */
	code?: string | number | { value: string | number; target: vscode.Uri }
	/** Optional source identifier for the diagnostic (e.g., the extension name). */
	source?: string
	/** The range within the document where the diagnostic applies. */
	range: vscode.Range
}

/**
 * Contextual information for a VSCode text editor.
 */
export interface EditorContext {
	/** The file path of the current document. */
	filePath: string
	/** The effective text selected or derived from the document. */
	selectedText: string
	/** Optional list of diagnostics associated with the effective range. */
	diagnostics?: DiagnosticData[]
}

/**
 * Utility class providing helper methods for working with VSCode editors and documents.
 */
export class EditorUtils {
	/** Cache mapping text documents to their computed file paths. */
	private static readonly filePathCache = new WeakMap<vscode.TextDocument, string>()

	/**
	 * Computes the effective range of text from the given document based on the user's selection.
	 * If the selection is non-empty, returns that directly.
	 * Otherwise, if the current line is non-empty, expands the range to include the adjacent lines.
	 *
	 * @param document - The text document to extract text from.
	 * @param range - The user selected range or selection.
	 * @returns An EffectiveRange object containing the effective range and its text, or null if no valid text is found.
	 */
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

			const startLineIndex = Math.max(0, currentLine.lineNumber - 1)
			const endLineIndex = Math.min(document.lineCount - 1, currentLine.lineNumber + 1)

			const effectiveRange = new vscode.Range(
				new vscode.Position(startLineIndex, 0),
				new vscode.Position(endLineIndex, document.lineAt(endLineIndex).text.length),
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

	/**
	 * Retrieves the file path of a given text document.
	 * Utilizes an internal cache to avoid redundant computations.
	 * If the document belongs to a workspace, attempts to compute a relative path; otherwise, returns the absolute fsPath.
	 *
	 * @param document - The text document for which to retrieve the file path.
	 * @returns The file path as a string.
	 */
	static getFilePath(document: vscode.TextDocument): string {
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

			this.filePathCache.set(document, filePath)
			return filePath
		} catch (error) {
			console.error("Error getting file path:", error)
			return document.uri.fsPath
		}
	}

	/**
	 * Converts a VSCode Diagnostic object to a local DiagnosticData instance.
	 *
	 * @param diagnostic - The VSCode diagnostic to convert.
	 * @returns The corresponding DiagnosticData object.
	 */
	static createDiagnosticData(diagnostic: vscode.Diagnostic): DiagnosticData {
		return {
			message: diagnostic.message,
			severity: diagnostic.severity,
			code: diagnostic.code,
			source: diagnostic.source,
			range: diagnostic.range,
		}
	}

	/**
	 * Determines whether two VSCode ranges intersect.
	 *
	 * @param range1 - The first range.
	 * @param range2 - The second range.
	 * @returns True if the ranges intersect; otherwise, false.
	 */
	static hasIntersectingRange(range1: vscode.Range, range2: vscode.Range): boolean {
		if (
			range1.end.line < range2.start.line ||
			(range1.end.line === range2.start.line && range1.end.character <= range2.start.character)
		) {
			return false
		}
		if (
			range2.end.line < range1.start.line ||
			(range2.end.line === range1.start.line && range2.end.character <= range1.start.character)
		) {
			return false
		}
		return true
	}

	/**
	 * Builds the editor context from the provided text editor or from the active text editor.
	 * The context includes file path, effective selected text, and any diagnostics that intersect with the effective range.
	 *
	 * @param editor - (Optional) A specific text editor instance. If not provided, the active text editor is used.
	 * @returns An EditorContext object if successful; otherwise, null.
	 */
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
