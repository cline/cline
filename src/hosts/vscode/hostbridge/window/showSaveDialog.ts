import { SaveDialogOptions, Uri, window } from "vscode"
import { ShowSaveDialogRequest, ShowSaveDialogResponse } from "@/shared/proto/index.host"

export async function showSaveDialog(request: ShowSaveDialogRequest): Promise<ShowSaveDialogResponse> {
	const { options } = request

	const vscodeOptions: SaveDialogOptions = {}

	if (options?.defaultPath) {
		vscodeOptions.defaultUri = Uri.file(options.defaultPath)
	}

	if (options?.filters && Object.keys(options.filters).length > 0) {
		vscodeOptions.filters = {}
		Object.entries(options.filters).forEach(([name, extensionList]) => {
			vscodeOptions.filters![name] = extensionList.extensions
		})
	}

	const selectedUri = await window.showSaveDialog(vscodeOptions)

	return ShowSaveDialogResponse.create({
		selectedPath: selectedUri?.fsPath,
	})
}
