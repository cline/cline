import { ExecuteCommandInTerminalRequest, ExecuteCommandInTerminalResponse } from "@shared/proto/host/workspace"
import * as vscode from "vscode"

/**
 * Executes a command in a new terminal
 * @param request The request containing the command to execute
 * @returns Response indicating success
 */
export async function executeCommandInTerminal(
	request: ExecuteCommandInTerminalRequest,
): Promise<ExecuteCommandInTerminalResponse> {
	try {
		// Create terminal with fixed options
		const terminalOptions: vscode.TerminalOptions = {
			name: "Cline",
			iconPath: new vscode.ThemeIcon("cline-icon"),
			env: {
				CLINE_ACTIVE: "true",
			},
		}

		// Create a new terminal
		const terminal = vscode.window.createTerminal(terminalOptions)

		// Show the terminal to the user
		terminal.show()

		// Send the command to the terminal
		terminal.sendText(request.command, true)

		return ExecuteCommandInTerminalResponse.create({
			success: true,
		})
	} catch (error) {
		console.error("Error executing command in terminal:", error)
		return ExecuteCommandInTerminalResponse.create({
			success: false,
		})
	}
}
