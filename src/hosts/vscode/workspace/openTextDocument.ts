import { OpenTextDocumentRequest, OpenTextDocumentResponse } from "@/shared/proto/index.host"
import * as vscode from "vscode"

export async function openTextDocument(request: OpenTextDocumentRequest): Promise<OpenTextDocumentResponse> {
	let document: vscode.TextDocument

	if (request.path) {
		// Open existing file
		const uri = vscode.Uri.file(request.path)
		document = await vscode.workspace.openTextDocument(uri)
	} else {
		// Create untitled document
		const options: { language?: string; content?: string } = {}
		if (request.content) {
			options.content = request.content
		}
		if (request.language) {
			options.language = request.language
		}
		document = await vscode.workspace.openTextDocument(options)
	}

	return OpenTextDocumentResponse.create({
		path: document.uri.fsPath,
		languageId: document.languageId,
		isUntitled: document.isUntitled,
	})
}
