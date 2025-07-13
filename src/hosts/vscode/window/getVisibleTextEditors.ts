import * as vscode from "vscode"
import { EmptyRequest } from "@/shared/proto/common"
import { VisibleTextEditorsInfo, VisibleTextEditorInfo, TextSelection } from "@/shared/proto/host/window"

export async function getVisibleTextEditors(request: EmptyRequest): Promise<VisibleTextEditorsInfo> {
	console.log("getVisibleTextEditors called with request:", request)
	const visibleEditors = vscode.window.visibleTextEditors
	const activeEditor = vscode.window.activeTextEditor

	const editors: VisibleTextEditorInfo[] = visibleEditors.map((editor) => {
		const selection = TextSelection.create({
			startLine: editor.selection.start.line,
			startCharacter: editor.selection.start.character,
			endLine: editor.selection.end.line,
			endCharacter: editor.selection.end.character,
		})

		return VisibleTextEditorInfo.create({
			documentPath: editor.document.uri.fsPath,
			viewColumn: editor.viewColumn,
			languageId: editor.document.languageId,
			selection,
			isActive: activeEditor === editor,
		})
	})

	return VisibleTextEditorsInfo.create({
		editors,
	})
}
