import { Empty, StringRequest } from "@shared/proto/cline/common"
import * as vscode from "vscode"

export async function openExternal(request: StringRequest): Promise<Empty> {
	try {
		const authUrl = await vscode.env.asExternalUri(vscode.Uri.parse(request.value))
		console.error("Opening external URL via VSCode:", authUrl.toString())

		await vscode.env.openExternal(vscode.Uri.parse(authUrl.toString()))
	} catch (err) {
		console.error("Failed to open external URL via VSCode:", err)
		throw err
	}
	return Empty.create({})
}
