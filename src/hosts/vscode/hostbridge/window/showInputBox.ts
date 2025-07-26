import * as vscode from "vscode"
import { ShowInputBoxRequest, ShowInputBoxResponse } from "@/shared/proto/index.host"

export async function showInputBox(request: ShowInputBoxRequest): Promise<ShowInputBoxResponse> {
	const response = await vscode.window.showInputBox({
		title: request.title,
		prompt: request.prompt,
		value: request.value,
	})
	return ShowInputBoxResponse.create({ response })
}
