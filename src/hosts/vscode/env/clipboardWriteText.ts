import { StringRequest, Boolean } from "@/shared/proto/common"
import * as vscode from "vscode"

export async function clipboardWriteText(request: StringRequest): Promise<Boolean> {
	await vscode.env.clipboard.writeText(request.value)
	return Boolean.create({ value: true })
}
