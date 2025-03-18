import * as vscode from "vscode"
import { ClineProvider } from "../core/webview/ClineProvider"
import { Terminal } from "../integrations/terminal/Terminal"
import { t } from "../i18n"

const TERMINAL_COMMAND_IDS = {
	ADD_TO_CONTEXT: "roo-cline.terminalAddToContext",
	FIX: "roo-cline.terminalFixCommand",
	FIX_IN_CURRENT_TASK: "roo-cline.terminalFixCommandInCurrentTask",
	EXPLAIN: "roo-cline.terminalExplainCommand",
	EXPLAIN_IN_CURRENT_TASK: "roo-cline.terminalExplainCommandInCurrentTask",
} as const

export const registerTerminalActions = (context: vscode.ExtensionContext) => {
	registerTerminalAction(context, TERMINAL_COMMAND_IDS.ADD_TO_CONTEXT, "TERMINAL_ADD_TO_CONTEXT")

	registerTerminalActionPair(context, TERMINAL_COMMAND_IDS.FIX, "TERMINAL_FIX", "What would you like Roo to fix?")

	registerTerminalActionPair(
		context,
		TERMINAL_COMMAND_IDS.EXPLAIN,
		"TERMINAL_EXPLAIN",
		"What would you like Roo to explain?",
	)
}

const registerTerminalAction = (
	context: vscode.ExtensionContext,
	command: string,
	promptType: "TERMINAL_ADD_TO_CONTEXT" | "TERMINAL_FIX" | "TERMINAL_EXPLAIN",
	inputPrompt?: string,
) => {
	context.subscriptions.push(
		vscode.commands.registerCommand(command, async (args: any) => {
			let content = args.selection
			if (!content || content === "") {
				content = await Terminal.getTerminalContents(promptType === "TERMINAL_ADD_TO_CONTEXT" ? -1 : 1)
			}

			if (!content) {
				vscode.window.showWarningMessage(t("common:warnings.no_terminal_content"))
				return
			}

			const params: Record<string, any> = {
				terminalContent: content,
			}

			if (inputPrompt) {
				params.userInput =
					(await vscode.window.showInputBox({
						prompt: inputPrompt,
					})) ?? ""
			}

			await ClineProvider.handleTerminalAction(command, promptType, params)
		}),
	)
}

const registerTerminalActionPair = (
	context: vscode.ExtensionContext,
	baseCommand: string,
	promptType: "TERMINAL_ADD_TO_CONTEXT" | "TERMINAL_FIX" | "TERMINAL_EXPLAIN",
	inputPrompt?: string,
) => {
	// Register new task version
	registerTerminalAction(context, baseCommand, promptType, inputPrompt)
	// Register current task version
	registerTerminalAction(context, `${baseCommand}InCurrentTask`, promptType, inputPrompt)
}
