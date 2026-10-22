import * as fs from "fs/promises"
import * as vscode from "vscode"
import { sanitizeCellForLLM } from "@/integrations/misc/notebook-utils"
import { ExtensionRegistryInfo } from "@/registry"
import { CommandContext } from "@/shared/proto/index.cline"
import { Logger } from "@/shared/services/Logger"
import { Controller } from "../../core/controller"
import { WebviewProvider } from "../../core/webview"
import { convertVscodeDiagnostics } from "./hostbridge/workspace/getDiagnostics"

/**
 * Finds the notebook cell that contains the selected text and returns its JSON representation
 * @param filePath Path to the .ipynb file
 * @param notebookCell The cell index from the active notebook editor
 * @returns JSON string of the matching cell, or null if no match found
 */
export async function findMatchingNotebookCell(filePath: string, notebookCell?: number): Promise<string | null> {
	try {
		// Read the notebook file directly
		const notebookContent = await fs.readFile(filePath, "utf8")
		const notebook = JSON.parse(notebookContent)

		if (!notebook.cells || !Array.isArray(notebook.cells)) {
			Logger.log("Invalid notebook structure: no cells array found")
			return null
		}

		Logger.log(`Loaded notebook with ${notebook.cells.length} cells`)

		if (typeof notebookCell === "number" && notebookCell >= 0 && notebookCell < notebook.cells.length) {
			Logger.log(`Using provided notebook cell number ${notebookCell}`)
			// Get a reference to the specific cell object
			const cellToProcess = notebook.cells[notebookCell]

			// Sanitize the cell outputs (truncate images, keep text outputs)
			return sanitizeCellForLLM(cellToProcess)
		}

		Logger.log("No valid notebook cell number provided")
		return null
	} catch (error) {
		Logger.error("Error in findMatchingNotebookCell:", error)
		return null
	}
}

/**
 * Returns the editor selection, expanded to the surrounding lines when it is empty.
 * Used by commands invoked without an explicit range (e.g. code actions triggered
 * from the lightbulb with just a cursor position).
 */
function getSelectionOrExpandedCursorRange(editor: vscode.TextEditor): vscode.Range {
	const CONTEXT_LINES_TO_EXPAND = 3
	const selection = editor.selection
	if (!selection.isEmpty) {
		return selection
	}
	const lastLine = editor.document.lineCount - 1
	const startLine = Math.max(0, selection.start.line - CONTEXT_LINES_TO_EXPAND)
	const endLine = Math.min(lastLine, selection.end.line + CONTEXT_LINES_TO_EXPAND)
	return new vscode.Range(startLine, 0, endLine, editor.document.lineAt(endLine).text.length)
}

/**
 * Gets the context needed for VSCode commands that interact with the editor
 * @param range Optional range to use instead of current selection
 * @param vscodeDiagnostics Optional diagnostics to include
 * @returns Context object with controller, selected text, file info, and problems
 */
export async function getContextForCommand(
	range?: vscode.Range,
	vscodeDiagnostics?: vscode.Diagnostic[],
	options?: {
		/**
		 * When true, the editor keeps focus when showing the sidebar webview.
		 * Use this for non-interruptive flows (e.g. copy terminal output to Cline).
		 */
		preserveEditorFocus?: boolean
	},
): Promise<
	| undefined
	| {
			controller: Controller
			commandContext: CommandContext
	  }
> {
	const activeWebview = await showWebview(options?.preserveEditorFocus ?? false)
	// Use the controller from the active instance
	const controller = activeWebview.controller

	const editor = vscode.window.activeTextEditor
	if (!editor) {
		// Fallback for notebooks with no cells (no text editor active)
		const activeNotebook = vscode.window.activeNotebookEditor
		if (!activeNotebook) {
			return
		}
		const filePath = activeNotebook.notebook.uri.fsPath
		const diagnostics = convertVscodeDiagnostics(vscodeDiagnostics || [])
		return { controller, commandContext: { selectedText: "", filePath, diagnostics, language: "" } }
	}
	// Use provided range if available, otherwise use current selection
	// (vscode command passes an argument in the first param by default, so we need to ensure it's a Range object)
	const intentRange = range instanceof vscode.Range ? range : editor.selection
	const textRange = range instanceof vscode.Range ? range : getSelectionOrExpandedCursorRange(editor)
	const selectedText = editor.document.getText(textRange)

	const filePath = editor.document.uri.fsPath
	const language = editor.document.languageId
	// When diagnostics aren't passed explicitly (e.g. code actions, which must not carry
	// command arguments), gather the document's diagnostics at the selection/cursor. This
	// matches CodeActionContext.diagnostics, which only covers the range the code action
	// was requested for, not the surrounding lines the text is expanded to.
	const effectiveDiagnostics =
		vscodeDiagnostics ??
		vscode.languages.getDiagnostics(editor.document.uri).filter((d) => d.range.intersection(intentRange) !== undefined)
	const diagnostics = convertVscodeDiagnostics(effectiveDiagnostics)
	const commandContext: CommandContext = {
		selectedText,
		filePath,
		diagnostics,
		language,
	}

	return { controller, commandContext }
}

export async function showWebview(preserveEditorFocus: boolean = true): Promise<WebviewProvider> {
	await vscode.commands.executeCommand(ExtensionRegistryInfo.commands.FocusChatInput, preserveEditorFocus)

	return WebviewProvider.getInstance()
}
