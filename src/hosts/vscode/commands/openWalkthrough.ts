import * as vscode from "vscode"
import { OpenWalkthroughRequest, OpenWalkthroughResponse } from "@/shared/proto/host/commands"

export async function openWalkthrough(request: OpenWalkthroughRequest): Promise<OpenWalkthroughResponse> {
	try {
		await vscode.commands.executeCommand("workbench.action.openWalkthrough", request.walkthroughId)

		return OpenWalkthroughResponse.create({
			success: true,
		})
	} catch (error) {
		console.error("Error opening walkthrough:", error)
		return OpenWalkthroughResponse.create({
			success: false,
		})
	}
}
