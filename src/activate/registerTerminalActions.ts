import * as vscode from "vscode"

import { TerminalActionId, TerminalActionPromptType } from "../schemas"
import { getTerminalCommand } from "../utils/commands"
import { ClineProvider } from "../core/webview/ClineProvider"
import { Terminal } from "../integrations/terminal/Terminal"
import { t } from "../i18n"

export const registerTerminalActions = (context: vscode.ExtensionContext) => {
	registerTerminalAction(context, "terminalAddToContext", "TERMINAL_ADD_TO_CONTEXT")
	registerTerminalAction(context, "terminalFixCommand", "TERMINAL_FIX")
	registerTerminalAction(context, "terminalExplainCommand", "TERMINAL_EXPLAIN")
}

const registerTerminalAction = (
	context: vscode.ExtensionContext,
	command: TerminalActionId,
	promptType: TerminalActionPromptType,
) => {
	context.subscriptions.push(
		vscode.commands.registerCommand(getTerminalCommand(command), async (args: any) => {
			let content = args.selection

			if (!content || content === "") {
				content = await Terminal.getTerminalContents(promptType === "TERMINAL_ADD_TO_CONTEXT" ? -1 : 1)
			}

			if (!content) {
				vscode.window.showWarningMessage(t("common:warnings.no_terminal_content"))
				return
			}

			await ClineProvider.handleTerminalAction(command, promptType, {
				terminalContent: content,
			})
		}),
	)
}
