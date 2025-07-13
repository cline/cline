import * as vscode from "vscode"
import { GetActiveTextEditorRequest, ActiveTextEditorInfo, TextSelection } from "@/shared/proto/host/window"

export async function getActiveTextEditor(request: GetActiveTextEditorRequest): Promise<ActiveTextEditorInfo> {
	console.log("getActiveTextEditor called with request:", request)
	const editor = vscode.window.activeTextEditor

	if (!editor) {
		return ActiveTextEditorInfo.create({
			isActive: false,
		})
	}

	const selection = TextSelection.create({
		startLine: editor.selection.start.line,
		startCharacter: editor.selection.start.character,
		endLine: editor.selection.end.line,
		endCharacter: editor.selection.end.character,
	})

	return ActiveTextEditorInfo.create({
		documentPath: editor.document.uri.fsPath,
		viewColumn: editor.viewColumn,
		languageId: editor.document.languageId,
		selection,
		isActive: true,
	})
}
