import * as vscode from "vscode"
import { OpenClineSidebarPanelRequest, OpenClineSidebarPanelResponse } from "@/shared/proto/index.host"

export async function openClineSidebarPanel(_: OpenClineSidebarPanelRequest): Promise<OpenClineSidebarPanelResponse> {
	await vscode.commands.executeCommand("claude-dev.SidebarProvider.focus")
	return {}
}
