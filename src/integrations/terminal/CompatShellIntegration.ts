import * as vscode from "vscode"

/**
 * Compatibility interface for shellIntegration property on vscode.Terminal.
 * Use this for older VSCode versions that do not have the official type.
 */
export interface CompatShellIntegration {
	cwd?: vscode.Uri
	executeCommand?: (command: string) => {
		read: () => AsyncIterable<string>
	}
}
