import * as vscode from "vscode"
import { ShowInputBoxRequest, SelectedResponse } from "@/shared/proto/index.host"

export async function showInputBox(request: ShowInputBoxRequest): Promise<SelectedResponse | undefined> {
	const selectedOption = await vscode.window.showInputBox({
		title: request.title,
		prompt: request.prompt,
		value: request.value,
		placeHolder: request.placeHolder,
		password: request.password,
		ignoreFocusOut: request.ignoreFocusOut,
	})
	return SelectedResponse.create({ selectedOption })
}
