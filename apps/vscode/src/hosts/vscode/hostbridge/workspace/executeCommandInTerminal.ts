import { ExecuteCommandInTerminalRequest, ExecuteCommandInTerminalResponse } from "@shared/proto/host/workspace"
import * as vscode from "vscode"
import { Logger } from "@/shared/services/Logger"

/**
 * Executes a command in a new terminal
 *
 * NOTE: This is a standalone HostBridge handler that creates its own VS Code
 * terminal independently of VscodeTerminalManager.  This creates a "grey area"
 * where commands run outside the unified terminal lifecycle (no terminal reuse,
 * no focus protection beyond preserveFocus, no LRU eviction, no busy tracking).
 *
 * TODO(P2): Refactor to delegate through VscodeTerminalManager.
 *   Integration path:
 *   1. VscodeExtensionHostProvider holds a VscodeTerminalManager instance.
 *   2. HostBridge gRPC handler receives the terminal manager reference during
 *      construction (or via a setter) from the extension host.
 *   3. This function calls `terminalManager.runCommand({ command, cwd,
 *      executionMode: "foreground" })` instead of raw vscode.window APIs,
 *      gaining terminal reuse, focus protection, and LRU eviction for free.
 *
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

		// Show the terminal without stealing keyboard focus from the active editor.
		terminal.show(true)

		// Send the command to the terminal
		terminal.sendText(request.command, true)

		return ExecuteCommandInTerminalResponse.create({
			success: true,
		})
	} catch (error) {
		Logger.error("Error executing command in terminal:", error)
		return ExecuteCommandInTerminalResponse.create({
			success: false,
		})
	}
}
