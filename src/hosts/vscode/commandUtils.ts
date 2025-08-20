import pWaitFor from "p-wait-for"
import * as vscode from "vscode"
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
): Promise<
	| undefined
	| {
			controller: Controller
			commandContext: CommandContext
	  }
> {
	const activeWebview = await focusChatInput()
	if (!activeWebview) {
		return
	}
	// Use the controller from the last active instance
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

export async function focusChatInput(): Promise<WebviewProvider | undefined> {
	await vscode.commands.executeCommand("cline.focusChatInput")

	// Wait for a webview instance to become available after focusing
	await pWaitFor(() => !!WebviewProvider.getLastActiveInstance())
	const activeWebview = WebviewProvider.getLastActiveInstance()
	if (!activeWebview) {
		console.error("No active webview to receive command")
		return
	}

	return activeWebview
}
