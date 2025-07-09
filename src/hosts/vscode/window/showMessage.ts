import { window } from "vscode"
import { SelectedResponse, ShowMessageRequest, ShowMessageType } from "@/shared/proto/index.host"

export async function showMessage(request: ShowMessageRequest): Promise<SelectedResponse | undefined> {
	const { message, type, options } = request
	const { modal, detail, items } = options || {}
	const option = items ? { modal, items } : { modal, detail }

	let selectedOption: string | undefined = undefined

	switch (type) {
		case ShowMessageType.ERROR:
			selectedOption = await window.showErrorMessage(message, option)
			break
		case ShowMessageType.WARNING:
			selectedOption = await window.showWarningMessage(message, option)
			break
		default:
			selectedOption = await window.showInformationMessage(message, option)
			break
	}

	return SelectedResponse.create({ selectedOption })
}
