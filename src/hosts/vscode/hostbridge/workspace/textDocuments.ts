import { TextDocumentsRequest, TextDocumentsResponse, TextEditorInfo } from "@/shared/proto/index.host"
import * as vscode from "vscode"
import { ViewColumn } from "vscode"

export async function textDocuments(_: TextDocumentsRequest): Promise<TextDocumentsResponse> {
	const visibleEditors = vscode.window.visibleTextEditors
	const editors =
		vscode.workspace.textDocuments?.map((doc) => ({
			documentPath: doc.uri.toString(),
			isActive: visibleEditors.some((editor) => editor.document === doc),
			viewColumn: visibleEditors.find((editor) => editor.document === doc)?.viewColumn ?? ViewColumn.Active,
		})) || []

	return TextDocumentsResponse.create({
		editors: editors.map((editor) => TextEditorInfo.create(editor)),
	})
}
