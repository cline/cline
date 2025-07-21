import { window, Uri, SaveDialogOptions } from "vscode"
import { ShowSaveDialogRequest, ShowSaveDialogResponse } from "@/shared/proto/index.host"

export async function showSaveDialog(request: ShowSaveDialogRequest): Promise<ShowSaveDialogResponse> {
	const { options } = request

	const vscodeOptions: SaveDialogOptions = {}

	if (options?.defaultUri) {
		vscodeOptions.defaultUri = Uri.file(options.defaultUri)
	}

	if (options?.filters && options.filters.length > 0) {
		vscodeOptions.filters = {}
		options.filters.forEach((filter) => {
			vscodeOptions.filters![filter.name] = filter.extensions
		})
	}

	const selectedUri = await window.showSaveDialog(vscodeOptions)

	return ShowSaveDialogResponse.create({
		selectedUri: selectedUri?.fsPath,
	})
}
