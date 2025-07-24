import * as vscode from "vscode"
import * as path from "path"
import { OpenFileRequest, OpenFileResponse } from "@/shared/proto/host/window"

export async function openFile(request: OpenFileRequest): Promise<OpenFileResponse> {
	try {
		const fileExtension = path.extname(request.filePath).toLowerCase()

		// Binary files that should open in system viewer (not VSCode text editor)
		const binaryExtensions = [
			".pdf",
			".docx",
			".xlsx",
			".pptx",
			".zip",
			".rar",
			".exe",
			".dmg",
			".pkg",
			".app",
			".deb",
			".rpm",
		]
		const shouldOpenInSystemViewer = binaryExtensions.includes(fileExtension)

		if (shouldOpenInSystemViewer) {
			// For binary files, use openExternal to open in system viewer
			await vscode.env.openExternal(vscode.Uri.file(request.filePath))
			return OpenFileResponse.create({ success: true })
		}

		// For text files, try opening in VSCode first
		try {
			await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(request.filePath))
			return OpenFileResponse.create({ success: true })
		} catch (error) {
			console.warn("vscode.open failed for text file, trying openExternal:", error)
			// Fallback to system viewer even for text files if VSCode can't handle them
			await vscode.env.openExternal(vscode.Uri.file(request.filePath))
			return OpenFileResponse.create({ success: true })
		}
	} catch (error) {
		console.error("Failed to open file with both methods:", error)
		return OpenFileResponse.create({ success: false })
	}
}
