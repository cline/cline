import * as vscode from "vscode"
import * as path from "path"
import { openFile } from "./open-file"

export function openMention(mention?: string): void {
	if (!mention) {
		return
	}

	if (mention.startsWith("/")) {
		const relPath = mention.slice(1)
		const cwd = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath).at(0)
		if (!cwd) {
			return
		}
		const absPath = path.resolve(cwd, relPath)
		if (mention.endsWith("/")) {
			vscode.commands.executeCommand("revealInExplorer", vscode.Uri.file(absPath))
			// vscode.commands.executeCommand("vscode.openFolder", , { forceNewWindow: false }) opens in new window
		} else {
			openFile(absPath)
		}
	} else if (mention === "problems") {
		vscode.commands.executeCommand("workbench.actions.view.problems")
	} else if (mention.startsWith("http")) {
		vscode.env.openExternal(vscode.Uri.parse(mention))
	}
}
