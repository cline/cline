import { EmptyRequest, String } from "@shared/proto/cline/common"
import * as vscode from "vscode"

export async function getIdeRedirectUri(_: EmptyRequest): Promise<String> {
	const uriScheme = vscode.env.uriScheme || "vscode"
	const baseUri = vscode.Uri.parse(`${uriScheme}://saoudrizwan.claude-dev`)
	const externalUri = await vscode.env.asExternalUri(baseUri)
	return { value: externalUri.toString(true) }
}
