import * as vscode from "vscode"
import { ShowOpenDialogueRequest, SelectedResources } from "@/shared/proto/host/window"

export async function showOpenDialogue(request: ShowOpenDialogueRequest): Promise<SelectedResources> {
	const options: vscode.OpenDialogOptions = {}

	if (request.canSelectMany !== undefined) {
		options.canSelectMany = request.canSelectMany
	}

	if (request.openLabel !== undefined) {
		options.openLabel = request.openLabel
	}

	if (request.filters?.files) {
		options.filters = {
			Files: request.filters.files,
		}
	}

	const selectedResources = await vscode.window.showOpenDialog(options)

	// Convert back to path format
	return SelectedResources.create({
		paths: selectedResources ? selectedResources.map((uri) => uri.fsPath) : [],
	})
}
