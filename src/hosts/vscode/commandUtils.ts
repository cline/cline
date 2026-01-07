import * as vscode from "vscode"
import { ExtensionRegistryInfo } from "@/registry"
import { CommandContext } from "@/shared/proto/index.cline"
import { Controller } from "../../core/controller"
import { WebviewProvider } from "../../core/webview"
import { convertVscodeDiagnostics } from "./hostbridge/workspace/getDiagnostics"

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
		return
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
