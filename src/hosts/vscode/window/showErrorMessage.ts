import * as vscode from "vscode"
import { SelectedResponse, ShowMessageRequest } from "@/shared/proto/index.host"

export async function showErrorMessage(
	message: string,
	args: Partial<ShowMessageRequest> = { modal: false },
): Promise<SelectedResponse | undefined> {
	const { modal, detail, items } = args
	const option = items ? { modal, items } : { modal, detail }
	const selectedOption = await vscode.window.showErrorMessage(message, option)
	return SelectedResponse.create({ selectedOption })
}
