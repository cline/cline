import { ShowInformationMessageRequest, ShowMessageResponse } from "@/shared/proto/index.host"
import * as vscode from "vscode"

export async function showInformationMessage(request: ShowInformationMessageRequest): Promise<ShowMessageResponse> {
	const { message, items } = request

	let selectedItem: string | undefined = undefined
	if (items && items.length > 0) {
		selectedItem = await vscode.window.showInformationMessage(message, ...items)
	} else {
		await vscode.window.showInformationMessage(message)
	}

	return ShowMessageResponse.create({
		selectedItem: selectedItem,
	})
}
