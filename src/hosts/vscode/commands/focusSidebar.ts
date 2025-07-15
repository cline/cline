import * as vscode from "vscode"
import { FocusSidebarRequest, FocusSidebarResponse } from "@/shared/proto/host/commands"

export async function focusSidebar(request: FocusSidebarRequest): Promise<FocusSidebarResponse> {
	try {
		await vscode.commands.executeCommand(request.providerId)

		return FocusSidebarResponse.create({
			success: true,
		})
	} catch (error) {
		console.error("Error focusing sidebar:", error)
		return FocusSidebarResponse.create({
			success: false,
		})
	}
}
