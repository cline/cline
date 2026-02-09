import { EmptyRequest, String } from "@shared/proto/beadsmith/common"
import * as vscode from "vscode"

export async function getIdeRedirectUri(_: EmptyRequest): Promise<String> {
	const uriScheme = vscode.env.uriScheme || "vscode"
	const url = `${uriScheme}://saoudrizwan.claude-dev`
	return { value: url }
}
