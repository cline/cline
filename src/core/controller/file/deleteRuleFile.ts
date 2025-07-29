import { deleteRuleFile as deleteRuleFileImpl } from "@core/context/instructions/user-instructions/rule-helpers"
import { RuleFile, RuleFileRequest } from "@shared/proto/cline/file"
import * as path from "path"
import { Controller } from ".."
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/host/window"

/**
 * Deletes a rule file from either global or workspace rules directory
 * @param controller The controller instance
 * @param request The request containing rule path and isGlobal flag
 * @returns Result with file path and display name
 * @throws Error if operation fails
 */
export async function deleteRuleFile(controller: Controller, request: RuleFileRequest): Promise<RuleFile> {
	if (
		typeof request.isGlobal !== "boolean" ||
		typeof request.rulePath !== "string" ||
		!request.rulePath ||
		!request.type ||
		typeof request.type !== "string"
	) {
		console.error("deleteRuleFile: Missing or invalid parameters", {
			isGlobal: typeof request.isGlobal === "boolean" ? request.isGlobal : `Invalid: ${typeof request.isGlobal}`,
			rulePath: typeof request.rulePath === "string" ? request.rulePath : `Invalid: ${typeof request.rulePath}`,
			type: typeof request.type === "string" ? request.type : `Invalid: ${typeof request.type}`,
		})
		throw new Error("Missing or invalid parameters")
	}

	const result = await deleteRuleFileImpl(controller.context, request.rulePath, request.isGlobal, request.type)

	if (!result.success) {
		throw new Error(result.message || "Failed to delete rule file")
	}

	// we refresh inside of the deleteRuleFileImpl(..) call
	//await refreshClineRulesToggles(controller.context, cwd)
	//await refreshExternalRulesToggles(controller.context, cwd)
	//await refreshWorkflowToggles(controller.context, cwd)
	await controller.postStateToWebview()

	const fileName = path.basename(request.rulePath)

	const fileTypeName = request.type === "workflow" ? "workflow" : "rule"

	const message = `${fileTypeName} file "${fileName}" deleted successfully`
	HostProvider.window.showMessage({
		type: ShowMessageType.INFORMATION,
		message,
	})

	return RuleFile.create({
		filePath: request.rulePath,
		displayName: fileName,
		alreadyExists: false,
	})
}
