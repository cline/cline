import * as vscode from "vscode"
import { OpenTextDocumentRequest, TextDocumentInfo } from "@/shared/proto/host/workspace"

export async function openTextDocument(request: OpenTextDocumentRequest): Promise<TextDocumentInfo> {
	let document: vscode.TextDocument

	if (request.path !== undefined) {
		// Open existing file by path
		const uri = vscode.Uri.file(request.path)
		document = await vscode.workspace.openTextDocument(uri)
	} else if (request.content !== undefined) {
		// Create new untitled document with content
		document = await vscode.workspace.openTextDocument({
			content: request.content.text,
			language: request.content.language || undefined,
		})
	} else {
		throw new Error("OpenTextDocumentRequest must specify either path or content")
	}

	return TextDocumentInfo.create({
		path: document.uri.fsPath,
		languageId: document.languageId,
		version: document.version,
		isUntitled: document.isUntitled,
	})
}
