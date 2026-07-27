import { Empty, StringRequest } from "@shared/proto/bedrock_coder/common"
import * as vscode from "vscode"

export async function openExternal(request: StringRequest): Promise<Empty> {
	const enabled = vscode.workspace.getConfiguration("bedrockCoder").get<boolean>("corporateAllowExternalNavigation", false)
	if (!enabled) {
		throw new Error(
			"External browser navigation is disabled by the corporate-safe policy. Enable bedrockCoder.corporateAllowExternalNavigation only for an explicitly reviewed user action.",
		)
	}
	const uri = vscode.Uri.parse(request.value)
	await vscode.env.openExternal(uri) // ← Routes to local browser in remote setups!
	return Empty.create({})
}
