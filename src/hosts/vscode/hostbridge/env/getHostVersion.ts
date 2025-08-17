import { GetHostVersionResponse } from "@/shared/proto/index.host"
import { EmptyRequest, String } from "@shared/proto/cline/common"
import * as vscode from "vscode"

export async function getHostVersion(_: EmptyRequest): Promise<GetHostVersionResponse> {
	return { platform: "VSCode", version: vscode.version }
}
