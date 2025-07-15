import { Empty, StringRequest } from "@/shared/proto/common"
import * as vscode from "vscode"

export async function openExternal(request: StringRequest): Promise<Empty> {
	console.log("openExternal called with request:", request)
	await vscode.env.openExternal(vscode.Uri.parse(request.value))
	return Empty.create()
}
