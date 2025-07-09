import * as vscode from "vscode"
import { SelectedResponse, ShowMessageRequest } from "@/shared/proto/index.host"

export async function showErrorMessage(
	message: string,
	{ modal, detail, items }: Partial<ShowMessageRequest> = { modal: false },
): Promise<SelectedResponse | undefined> {
	const selectedOption = await vscode.window.showErrorMessage(message, { modal, detail }, ...(items?.options || []))

	return SelectedResponse.create({ selectedOption })
}
