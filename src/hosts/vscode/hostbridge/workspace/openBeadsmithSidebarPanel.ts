import * as vscode from "vscode"
import { ExtensionRegistryInfo } from "@/registry"
import { OpenBeadsmithSidebarPanelRequest, OpenBeadsmithSidebarPanelResponse } from "@/shared/proto/index.host"

export async function openBeadsmithSidebarPanel(_: OpenBeadsmithSidebarPanelRequest): Promise<OpenBeadsmithSidebarPanelResponse> {
	await vscode.commands.executeCommand(`${ExtensionRegistryInfo.views.Sidebar}.focus`)
	return {}
}
