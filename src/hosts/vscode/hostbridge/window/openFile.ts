import * as vscode from "vscode"
import { OpenFileRequest, OpenFileResponse } from "@/shared/proto/host/window"

export async function openFile(request: OpenFileRequest): Promise<OpenFileResponse> {
	try {
		await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(request.filePath))

		return OpenFileResponse.create({
			success: true,
		})
	} catch (error) {
		console.error("Failed to open file:", error)
		return OpenFileResponse.create({
			success: false,
		})
	}
}
