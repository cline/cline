import * as fs from "fs/promises"
import * as vscode from "vscode"
import { sanitizeCellForLLM } from "@/integrations/misc/notebook-utils"
import { ExtensionRegistryInfo } from "@/registry"
import { Logger } from "@/services/logging/Logger"
import { CommandContext } from "@/shared/proto/index.cline"
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
	const textRange = range instanceof vscode.Range ? range : editor.selection
	const selectedText = editor.document.getText(textRange)

	const filePath = editor.document.uri.fsPath
	const language = editor.document.languageId
	const diagnostics = convertVscodeDiagnostics(vscodeDiagnostics || [])
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
