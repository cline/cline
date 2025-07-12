import * as vscode from "vscode"
import { TerminalInfo } from "@shared/proto/host/terminal"
import { EmptyRequest } from "@shared/proto/common"

export async function getActiveTerminal(request: EmptyRequest): Promise<TerminalInfo> {
	const activeTerminal = vscode.window.activeTerminal

	if (!activeTerminal) {
		// Return empty terminal info if no active terminal
		return TerminalInfo.create({
			id: "",
			name: "",
			isActive: false,
		})
	}

	// Convert VSCode terminal to TerminalInfo
	const terminalInfo: TerminalInfo = TerminalInfo.create({
		id: activeTerminal.name, // Use name as ID for now
		name: activeTerminal.name,
		isActive: true,
		processId: await activeTerminal.processId,
		creationOptionsCwd: (activeTerminal.creationOptions as any)?.cwd?.toString(),
		shellPath: (activeTerminal.creationOptions as any)?.shellPath,
		exitStatus: activeTerminal.exitStatus?.code,
	})

	return terminalInfo
}
