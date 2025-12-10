import * as vscode from "vscode"

import { GetActiveEditorRequest, GetActiveEditorResponse } from "@/shared/proto/index.host"

export async function getActiveEditor(_: GetActiveEditorRequest): Promise<GetActiveEditorResponse> {
	const filePath = vscode.window.activeTextEditor?.document.uri.fsPath
	return { filePath }
}
