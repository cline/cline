import { EmptyRequest } from "@shared/proto/cline/common"
import * as vscode from "vscode"
import { GetHostVersionResponse } from "@/shared/proto/index.host"

export async function getHostVersion(_: EmptyRequest): Promise<GetHostVersionResponse> {
	return { platform: "VSCode", version: vscode.version }
}
