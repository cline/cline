import * as vscode from "vscode"
import { ShowTextDocumentRequest, TextEditorInfo } from "@/shared/proto/host/window"

export async function showTextDocument(request: ShowTextDocumentRequest): Promise<TextEditorInfo> {
	const uri = vscode.Uri.parse(request.uri)
	const options: vscode.TextDocumentShowOptions = {}

	if (request.options?.preview !== undefined) {
		options.preview = request.options.preview
	}
	if (request.options?.preserveFocus !== undefined) {
		options.preserveFocus = request.options.preserveFocus
	}
	if (request.options?.viewColumn !== undefined) {
		options.viewColumn = request.options.viewColumn
	}

	const editor = await vscode.window.showTextDocument(uri, options)

	return TextEditorInfo.create({
		documentUri: editor.document.uri.toString(),
		viewColumn: editor.viewColumn,
		isActive: vscode.window.activeTextEditor === editor,
	})
}
