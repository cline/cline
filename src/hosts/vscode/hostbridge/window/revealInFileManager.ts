import { RevealInFileManagerRequest, RevealInFileManagerResponse } from "@shared/proto/host/window"
import * as vscode from "vscode"

/**
 * Reveals a file or folder in the OS file manager (Finder, Explorer, etc.)
 */
export async function revealInFileManager(request: RevealInFileManagerRequest): Promise<RevealInFileManagerResponse> {
	await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(request.filePath))
	return RevealInFileManagerResponse.create()
}
