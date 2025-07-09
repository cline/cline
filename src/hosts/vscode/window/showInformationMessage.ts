import * as vscode from "vscode"
import { SelectedResponse, ShowMessageRequest } from "@/shared/proto/index.host"

export async function showInformationMessage(
	message: string,
	args: Partial<ShowMessageRequest> = { modal: false },
): Promise<SelectedResponse | undefined> {
	const { modal, detail, items } = args
	const option = items ? { modal, items } : { modal, detail }
	const selectedOption = await vscode.window.showInformationMessage(message, option)
	return SelectedResponse.create({ selectedOption })
}
