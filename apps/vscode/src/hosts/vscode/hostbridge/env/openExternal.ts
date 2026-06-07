import { Empty, StringRequest } from "@shared/proto/cline/common"
import * as vscode from "vscode"

const ALLOWED_EXTERNAL_URI_SCHEMES = new Set(["http", "https", "mailto"])

export async function openExternal(request: StringRequest): Promise<Empty> {
	const uri = vscode.Uri.parse(request.value)
	if (!ALLOWED_EXTERNAL_URI_SCHEMES.has(uri.scheme.toLowerCase())) {
		throw new Error(`Unsupported external URI scheme: ${uri.scheme}`)
	}
	await vscode.env.openExternal(uri) // ← Routes to local browser in remote setups!
	return Empty.create({})
}
