import { EmptyRequest } from "@shared/proto/cline/common"
import * as vscode from "vscode"
import { GetUriSchemeResponse } from "@/shared/proto/index.host"

export async function getUriScheme(_: EmptyRequest): Promise<GetUriSchemeResponse> {
	const uriScheme = vscode.env.uriScheme || "vscode"
	return { uriScheme }
}
