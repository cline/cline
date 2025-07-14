import * as vscode from "vscode"
import { OpenTextDocumentRequest, TextDocumentInfo } from "@/shared/proto/host/workspace"

export async function openTextDocument(request: OpenTextDocumentRequest): Promise<TextDocumentInfo> {
	const uri = vscode.Uri.file(request.path)
	const document = await vscode.workspace.openTextDocument(uri)

	return TextDocumentInfo.create({
		path: document.uri.fsPath,
		languageId: document.languageId,
		version: document.version,
		isUntitled: document.isUntitled,
	})
}
