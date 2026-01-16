import * as vscode from "vscode"
import { SelectedResources, ShowOpenDialogueRequest } from "@/shared/proto/host/window"

export async function showOpenDialogue(request: ShowOpenDialogueRequest): Promise<SelectedResources> {
	const options: vscode.OpenDialogOptions = {}

	if (request.canSelectMany !== undefined) {
		options.canSelectMany = request.canSelectMany
	}

	if (request.openLabel !== undefined) {
		options.openLabel = request.openLabel
	}

	if (request.filters?.files && request.filters.files.length > 0) {
		// Separate image extensions from other file extensions for better UX
		const imageExtensions = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "ico"]
		const images = request.filters.files.filter((ext) => imageExtensions.includes(ext))
		const others = request.filters.files.filter((ext) => !imageExtensions.includes(ext))

		const filters: { [key: string]: string[] } = {}
		if (images.length > 0) {
			filters.Images = images
		}
		if (others.length > 0) {
			filters.Files = others
		}

		if (Object.keys(filters).length > 0) {
			options.filters = filters
		}
	}

	const selectedResources = await vscode.window.showOpenDialog(options)

	// Convert back to path format
	return SelectedResources.create({
		paths: selectedResources ? selectedResources.map((uri) => uri.fsPath) : [],
	})
}
