import { Controller } from ".."
import { DeleteRuleFileRequest, DeleteRuleFileResponse } from "@shared/proto/file"
import { FileMethodHandler } from "./index"
import {
	deleteRuleFile as deleteRuleFileImpl,
	refreshClineRulesToggles,
} from "@core/context/instructions/user-instructions/cline-rules"
import * as vscode from "vscode"
import { cwd } from "@core/task"

/**
 * Deletes a rule file from either global or workspace rules directory
 * @param controller The controller instance
 * @param request The request containing rule path and isGlobal flag
 * @returns Response with success status and message
 */
export const deleteRuleFile: FileMethodHandler = async (
	controller: Controller,
	request: DeleteRuleFileRequest,
): Promise<DeleteRuleFileResponse> => {
	if (typeof request.isGlobal !== "boolean" || typeof request.rulePath !== "string" || !request.rulePath) {
		console.error("deleteRuleFile: Missing or invalid parameters", {
			isGlobal: typeof request.isGlobal === "boolean" ? request.isGlobal : `Invalid: ${typeof request.isGlobal}`,
			rulePath: typeof request.rulePath === "string" ? request.rulePath : `Invalid: ${typeof request.rulePath}`,
		})
		return DeleteRuleFileResponse.create({
			success: false,
			message: "Missing or invalid parameters",
		})
	}

	const result = await deleteRuleFileImpl(controller.context, request.rulePath, request.isGlobal)

	if (result.success) {
		await refreshClineRulesToggles(controller.context, cwd)
		await controller.postStateToWebview()

		const fileName = request.rulePath.split("/").pop() || request.rulePath
		vscode.window.showInformationMessage(`Rule file "${fileName}" deleted successfully`)
	} else {
		vscode.window.showErrorMessage(result.message)
	}

	return DeleteRuleFileResponse.create({
		success: result.success,
		message: result.message,
	})
}
