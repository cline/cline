import * as vscode from "vscode"
import { SelectedResponse, ShowMessageRequest } from "@/shared/proto/index.host"

export async function showInformationMessage(
	message: string,
	{ modal, detail, items }: Partial<ShowMessageRequest> = { modal: false },
): Promise<SelectedResponse | undefined> {
	const selectedOption = await vscode.window.showInformationMessage(message, { modal, detail }, ...(items?.options || []))

	return SelectedResponse.create({ selectedOption })
}
