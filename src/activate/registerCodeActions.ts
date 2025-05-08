import * as vscode from "vscode"

import { EditorUtils } from "../integrations/editor/EditorUtils"
import { ClineProvider } from "../core/webview/ClineProvider"

import { type CodeActionName, type CodeActionId, COMMAND_IDS } from "./CodeActionProvider"

export const registerCodeActions = (context: vscode.ExtensionContext) => {
	registerCodeAction(context, COMMAND_IDS.EXPLAIN, "EXPLAIN")
	registerCodeAction(context, COMMAND_IDS.FIX, "FIX")
	registerCodeAction(context, COMMAND_IDS.IMPROVE, "IMPROVE")
	registerCodeAction(context, COMMAND_IDS.ADD_TO_CONTEXT, "ADD_TO_CONTEXT")
}

const registerCodeAction = (context: vscode.ExtensionContext, command: CodeActionId, promptType: CodeActionName) => {
	let userInput: string | undefined

	context.subscriptions.push(
		vscode.commands.registerCommand(command, async (...args: any[]) => {
			// Handle both code action and direct command cases.
			let filePath: string
			let selectedText: string
			let startLine: number | undefined
			let endLine: number | undefined
			let diagnostics: any[] | undefined

			if (args.length > 1) {
				// Called from code action.
				;[filePath, selectedText, startLine, endLine, diagnostics] = args
			} else {
				// Called directly from command palette.
				const context = EditorUtils.getEditorContext()

				if (!context) {
					return
				}

				;({ filePath, selectedText, startLine, endLine, diagnostics } = context)
			}

			const params = {
				...{ filePath, selectedText },
				...(startLine !== undefined ? { startLine: startLine.toString() } : {}),
				...(endLine !== undefined ? { endLine: endLine.toString() } : {}),
				...(diagnostics ? { diagnostics } : {}),
				...(userInput ? { userInput } : {}),
			}

			await ClineProvider.handleCodeAction(command, promptType, params)
		}),
	)
}
