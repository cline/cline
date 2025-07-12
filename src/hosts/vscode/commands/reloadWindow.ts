import * as vscode from "vscode"
import { ReloadWindowRequest, ReloadWindowResponse } from "@/shared/proto/host/commands"

export async function reloadWindow(request: ReloadWindowRequest): Promise<ReloadWindowResponse> {
	try {
		await vscode.commands.executeCommand("workbench.action.reloadWindow")

		return ReloadWindowResponse.create({
			success: true,
		})
	} catch (error) {
		console.error("Error reloading window:", error)
		return ReloadWindowResponse.create({
			success: false,
		})
	}
}
