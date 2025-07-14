import * as vscode from "vscode"
import { LockEditorGroupRequest, LockEditorGroupResponse } from "@/shared/proto/host/commands"

export async function lockEditorGroup(request: LockEditorGroupRequest): Promise<LockEditorGroupResponse> {
	try {
		await vscode.commands.executeCommand("workbench.action.lockEditorGroup")

		return LockEditorGroupResponse.create({
			success: true,
		})
	} catch (error) {
		console.error("Error locking editor group:", error)
		return LockEditorGroupResponse.create({
			success: false,
		})
	}
}
