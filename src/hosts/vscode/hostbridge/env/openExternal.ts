import { Empty, StringRequest } from "@shared/proto/cline/common"
import * as vscode from "vscode"

export async function openExternal(request: StringRequest): Promise<Empty> {
	await vscode.env.openExternal(vscode.Uri.parse(request.value))
	return Empty.create({})
}
