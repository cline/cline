import { ShowErrorMessageRequest, ShowMessageResponse } from "@/shared/proto/index.host"
import * as vscode from "vscode"

export async function showErrorMessage(request: ShowErrorMessageRequest): Promise<ShowMessageResponse> {
	const { message, items } = request

	let selectedItem: string | undefined = undefined
	if (items && items.length > 0) {
		selectedItem = await vscode.window.showErrorMessage(message, ...items)
	} else {
		await vscode.window.showErrorMessage(message)
	}

	return ShowMessageResponse.create({
		selectedItem: selectedItem,
	})
}
