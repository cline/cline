import * as vscode from "vscode"
import { OpenSettingsRequest, OpenSettingsResponse } from "@/shared/proto/host/window"

export async function openSettings(request: OpenSettingsRequest): Promise<OpenSettingsResponse> {
	// VS Code can be queried to focus a specific setting section
	await vscode.commands.executeCommand("workbench.action.openSettings", request.query ?? undefined)
	return OpenSettingsResponse.create({})
}
