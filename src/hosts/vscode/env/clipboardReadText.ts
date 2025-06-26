import { EmptyRequest, String } from "@/shared/proto/common"
import * as vscode from "vscode"

export async function clipboardReadText(_: EmptyRequest): Promise<String> {
	const text = await vscode.env.clipboard.readText()
	return String.create({ value: text })
}
