import * as vscode from "vscode"
import { TerminalInfo, TerminalInfoList } from "@shared/proto/host/terminal"
import { EmptyRequest } from "@shared/proto/common"

export async function getAllTerminals(request: EmptyRequest): Promise<TerminalInfoList> {
	const terminals = vscode.window.terminals
	const activeTerminal = vscode.window.activeTerminal

	const terminalInfos: TerminalInfo[] = await Promise.all(
		terminals.map(async (terminal) =>
			TerminalInfo.create({
				id: terminal.name, // Use name as ID for now
				name: terminal.name,
				isActive: terminal === activeTerminal,
				processId: await terminal.processId,
				creationOptionsCwd: (terminal.creationOptions as any)?.cwd?.toString(),
				shellPath: (terminal.creationOptions as any)?.shellPath,
				exitStatus: terminal.exitStatus?.code,
			}),
		),
	)

	return TerminalInfoList.create({
		terminals: terminalInfos,
	})
}
