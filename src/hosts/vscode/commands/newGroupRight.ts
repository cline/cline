import * as vscode from "vscode"
import { NewGroupRightRequest, NewGroupRightResponse } from "@/shared/proto/host/commands"

export async function newGroupRight(request: NewGroupRightRequest): Promise<NewGroupRightResponse> {
	try {
		await vscode.commands.executeCommand("workbench.action.newGroupRight")

		return NewGroupRightResponse.create({
			success: true,
		})
	} catch (error) {
		console.error("Error creating new group right:", error)
		return NewGroupRightResponse.create({
			success: false,
		})
	}
}
