import { EmptyRequest } from "@shared/proto/cline/common"
import * as vscode from "vscode"
import { ExtensionRegistryInfo } from "@/registry"
import { ClineClient } from "@/shared/cline"
import { GetHostVersionResponse } from "@/shared/proto/index.host"

export async function getHostVersion(_: EmptyRequest): Promise<GetHostVersionResponse> {
	return {
		platform: vscode.env.appName,
		version: vscode.version,
		clineType: ClineClient.VSCode,
		clineVersion: ExtensionRegistryInfo.version,
	}
}
