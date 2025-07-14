import * as vscode from "vscode"
import { ShowSaveDialogRequest, ShowSaveDialogResponse } from "@/shared/proto/host/window"

export async function showSaveDialog(request: ShowSaveDialogRequest): Promise<ShowSaveDialogResponse> {
	const options: vscode.SaveDialogOptions = {}

	if (request.filters?.filterMap) {
		const filters: Record<string, string[]> = {}
		for (const [key, value] of Object.entries(request.filters.filterMap)) {
			filters[key] = value.extensions || []
		}
		options.filters = filters
	}

	if (request.defaultUri) {
		options.defaultUri = vscode.Uri.file(request.defaultUri)
	}

	if (request.saveLabel) {
		options.saveLabel = request.saveLabel
	}

	const result = await vscode.window.showSaveDialog(options)

	return ShowSaveDialogResponse.create({
		path: result?.fsPath,
	})
}
