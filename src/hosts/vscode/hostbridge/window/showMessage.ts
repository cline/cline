import { window } from "vscode"
import { SelectedResponse, ShowMessageRequest, ShowMessageType } from "@/shared/proto/index.host"

const DEFAULT_OPTIONS = { modal: false, items: [] } as const

export async function showMessage(request: ShowMessageRequest): Promise<SelectedResponse | undefined> {
	const { message, type, options } = request
	const { modal, detail, items } = { ...DEFAULT_OPTIONS, ...options }
	const option = { modal, detail }

	let selectedOption: string | undefined = undefined

	switch (type) {
		case ShowMessageType.ERROR:
			selectedOption = await window.showErrorMessage(message, option, ...items)
			break
		case ShowMessageType.WARNING:
			selectedOption = await window.showWarningMessage(message, option, ...items)
			break
		default:
			selectedOption = await window.showInformationMessage(message, option, ...items)
			break
	}

	return SelectedResponse.create({ selectedOption })
}
