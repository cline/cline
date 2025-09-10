import * as vscode from "vscode"
import { OpenClineSidebarPanelRequest, OpenClineSidebarPanelResponse } from "@/shared/proto/index.host"
import { name as pkgName } from "../../../../../package.json"

export async function openClineSidebarPanel(_: OpenClineSidebarPanelRequest): Promise<OpenClineSidebarPanelResponse> {
	await vscode.commands.executeCommand(`${pkgName}.SidebarProvider.focus`)
	return {}
}
