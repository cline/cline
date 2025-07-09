import * as vscode from "vscode"
import { SelectedResponse } from "@/shared/proto/index.host"

export async function showInputBox(options: vscode.InputBoxOptions): Promise<SelectedResponse | undefined> {
	const selectedOption = await vscode.window.showInputBox(options)
	return SelectedResponse.create({ selectedOption })
}
