import * as vscode from "vscode"
import { ClineProvider } from "../core/webview/ClineProvider"
import { TerminalManager } from "../integrations/terminal/TerminalManager"

const TERMINAL_COMMAND_IDS = {
	ADD_TO_CONTEXT: "roo-cline.terminalAddToContext",
	FIX: "roo-cline.terminalFixCommand",
	FIX_IN_CURRENT_TASK: "roo-cline.terminalFixCommandInCurrentTask",
	EXPLAIN: "roo-cline.terminalExplainCommand",
	EXPLAIN_IN_CURRENT_TASK: "roo-cline.terminalExplainCommandInCurrentTask",
} as const

export const registerTerminalActions = (context: vscode.ExtensionContext) => {
	const terminalManager = new TerminalManager()

	registerTerminalAction(context, terminalManager, TERMINAL_COMMAND_IDS.ADD_TO_CONTEXT, "TERMINAL_ADD_TO_CONTEXT")

	registerTerminalActionPair(context, terminalManager, TERMINAL_COMMAND_IDS.FIX, "TERMINAL_FIX")

	registerTerminalActionPair(context, terminalManager, TERMINAL_COMMAND_IDS.EXPLAIN, "TERMINAL_EXPLAIN")
}

const registerTerminalAction = (
	context: vscode.ExtensionContext,
	terminalManager: TerminalManager,
	command: string,
	promptType: "TERMINAL_ADD_TO_CONTEXT" | "TERMINAL_FIX" | "TERMINAL_EXPLAIN",
) => {
	context.subscriptions.push(
		vscode.commands.registerCommand(command, async (args: any) => {
			let content = args.selection
			if (!content || content === "") {
				content = await terminalManager.getTerminalContents(promptType === "TERMINAL_ADD_TO_CONTEXT" ? -1 : 1)
			}

			if (!content) {
				vscode.window.showWarningMessage("No terminal content selected")
				return
			}

			await ClineProvider.handleTerminalAction(command, promptType, content)
		}),
	)
}

const registerTerminalActionPair = (
	context: vscode.ExtensionContext,
	terminalManager: TerminalManager,
	baseCommand: string,
	promptType: "TERMINAL_ADD_TO_CONTEXT" | "TERMINAL_FIX" | "TERMINAL_EXPLAIN",
) => {
	// Register new task version
	registerTerminalAction(context, terminalManager, baseCommand, promptType)
	// Register current task version
	registerTerminalAction(context, terminalManager, `${baseCommand}InCurrentTask`, promptType)
}
