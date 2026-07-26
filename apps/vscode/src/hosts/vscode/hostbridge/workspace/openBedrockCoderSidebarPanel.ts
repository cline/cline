import * as vscode from "vscode"
import { ExtensionRegistryInfo } from "@/registry"
import { OpenBedrockCoderSidebarPanelRequest, OpenBedrockCoderSidebarPanelResponse } from "@/shared/proto/index.host"

export async function openBedrockCoderSidebarPanel(
	_: OpenBedrockCoderSidebarPanelRequest,
): Promise<OpenBedrockCoderSidebarPanelResponse> {
	await vscode.commands.executeCommand(`${ExtensionRegistryInfo.views.Sidebar}.focus`)
	return {}
}
