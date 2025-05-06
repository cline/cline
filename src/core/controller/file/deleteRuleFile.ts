import { Controller } from ".."
import { RuleFileRequest, RuleFile } from "@shared/proto/file"
import { FileMethodHandler } from "./index"
import {
	deleteRuleFile as deleteRuleFileImpl,
	refreshClineRulesToggles,
} from "@core/context/instructions/user-instructions/cline-rules"
import { refreshExternalRulesToggles } from "@core/context/instructions/user-instructions/external-rules"
import * as vscode from "vscode"
import * as path from "path"
import { cwd } from "@core/task"

/**
 * Deletes a rule file from either global or workspace rules directory
 * @param controller The controller instance
 * @param request The request containing rule path and isGlobal flag
 * @returns Result with file path and display name
 * @throws Error if operation fails
 */
export const deleteRuleFile: FileMethodHandler = async (controller: Controller, request: RuleFileRequest): Promise<RuleFile> => {
	if (typeof request.isGlobal !== "boolean" || typeof request.rulePath !== "string" || !request.rulePath) {
		console.error("deleteRuleFile: Missing or invalid parameters", {
			isGlobal: typeof request.isGlobal === "boolean" ? request.isGlobal : `Invalid: ${typeof request.isGlobal}`,
			rulePath: typeof request.rulePath === "string" ? request.rulePath : `Invalid: ${typeof request.rulePath}`,
		})
		throw new Error("Missing or invalid parameters")
	}

	const result = await deleteRuleFileImpl(controller.context, request.rulePath, request.isGlobal)

	if (!result.success) {
		throw new Error(result.message || "Failed to delete rule file")
	}

	await refreshClineRulesToggles(controller.context, cwd)
	await refreshExternalRulesToggles(controller.context, cwd)
	await controller.postStateToWebview()

	const fileName = path.basename(request.rulePath)
	vscode.window.showInformationMessage(`Rule file "${fileName}" deleted successfully`)

	return RuleFile.create({
		filePath: request.rulePath,
		displayName: fileName,
		alreadyExists: false,
	})
}
