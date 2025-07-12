import { ShowWarningMessageRequest, ShowMessageResponse } from "@/shared/proto/index.host"
import * as vscode from "vscode"

export async function showWarningMessage(request: ShowWarningMessageRequest): Promise<ShowMessageResponse> {
	const { message, items } = request

	let selectedItem: string | undefined = undefined
	if (items && items.length > 0) {
		selectedItem = await vscode.window.showWarningMessage(message, ...items)
	} else {
		await vscode.window.showWarningMessage(message)
	}

	return ShowMessageResponse.create({
		selectedItem: selectedItem,
	})
}
