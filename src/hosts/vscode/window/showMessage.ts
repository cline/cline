import { window } from "vscode"
import { ShowMessageRequest, SelectedResponse } from "@/shared/proto/index.host"

enum WindowMessageType {
	Error = "error",
	Information = "information",
	Warning = "warning",
}

async function showMessage(type: WindowMessageType, request: ShowMessageRequest): Promise<SelectedResponse | undefined> {
	const { message, modal, detail, items } = request
	const option = items ? { modal, items } : { modal, detail }

	let selectedOption: string | undefined = undefined

	switch (type) {
		case WindowMessageType.Error:
			selectedOption = await window.showErrorMessage(message, option)
			break
		case WindowMessageType.Warning:
			selectedOption = await window.showWarningMessage(message, option)
			break
		default:
			selectedOption = await window.showInformationMessage(message, option)
			break
	}

	return SelectedResponse.create({ selectedOption })
}

export function showErrorMessage(message: string, args?: Partial<ShowMessageRequest>): Promise<SelectedResponse | undefined> {
	return showMessage(WindowMessageType.Error, { ...args, message })
}

export function showInformationMessage(
	message: string,
	args?: Partial<ShowMessageRequest>,
): Promise<SelectedResponse | undefined> {
	return showMessage(WindowMessageType.Information, { ...args, message })
}

export function showWarningMessage(message: string, args?: Partial<ShowMessageRequest>): Promise<SelectedResponse | undefined> {
	return showMessage(WindowMessageType.Warning, { ...args, message })
}
