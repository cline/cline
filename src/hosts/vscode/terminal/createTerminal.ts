import * as vscode from "vscode"
import { CreateTerminalRequest, TerminalInfo } from "@shared/proto/host/terminal"

export async function createTerminal(request: CreateTerminalRequest): Promise<TerminalInfo> {
	const options: vscode.TerminalOptions = {
		name: request.name,
		cwd: request.cwd,
		shellPath: request.shellPath,
	}

	// Handle icon if provided
	if (request.icon) {
		if (request.icon.themeIcon) {
			options.iconPath = new vscode.ThemeIcon(request.icon.themeIcon)
		} else if (request.icon.filePath) {
			options.iconPath = vscode.Uri.file(request.icon.filePath)
		}
	}

	const terminal = vscode.window.createTerminal(options)

	// Convert VSCode terminal to TerminalInfo
	const terminalInfo: TerminalInfo = TerminalInfo.create({
		id: terminal.name, // Use name as ID for now
		name: terminal.name,
		isActive: terminal === vscode.window.activeTerminal,
		processId: await terminal.processId,
		creationOptionsCwd: request.cwd,
		shellPath: request.shellPath,
		exitStatus: terminal.exitStatus?.code,
	})

	return terminalInfo
}
