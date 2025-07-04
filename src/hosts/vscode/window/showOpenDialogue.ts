import * as vscode from "vscode"
import { ShowOpenDialogueRequest, SelectedResources } from "@/shared/proto/host/window"

export async function showOpenDialogue(request: ShowOpenDialogueRequest): Promise<SelectedResources> {
	const options: vscode.OpenDialogOptions = {}

	if (request?.options?.canSelectMany !== undefined) {
		options.canSelectMany = request.options.canSelectMany
	}

	if (request?.options?.openLabel !== undefined) {
		options.openLabel = request.options.openLabel
	}

	if (request?.options?.filters) {
		const filters = request.options.filters

		const files = filters?.files

		if (files && files.length > 0) {
			options.filters = {
				Files: files,
			}
		}
	}

	const selectedResources = await vscode.window.showOpenDialog(options)

	// Convert back to path format
	return SelectedResources.create({
		paths: selectedResources ? selectedResources.map((uri) => uri.fsPath) : [],
	})
}
