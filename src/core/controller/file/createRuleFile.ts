import { Controller } from ".."
import { RuleFileRequest, RuleFile } from "@shared/proto/file"
import { FileMethodHandler } from "./index"
import { refreshClineRulesToggles } from "@core/context/instructions/user-instructions/cline-rules"
import { createRuleFile as createRuleFileImpl } from "@core/context/instructions/user-instructions/rule-helpers"
import * as vscode from "vscode"
import * as path from "path"
import { handleFileServiceRequest } from "./index"
import { refreshWorkflowToggles } from "@/core/context/instructions/user-instructions/workflows"
import { getCwd, getDesktopDir } from "@/utils/path"

/**
 * Creates a rule file in either global or workspace rules directory
 * @param controller The controller instance
 * @param request The request containing filename and isGlobal flag
 * @returns Result with file path and display name
 * @throws Error if operation fails
 */
export const createRuleFile: FileMethodHandler = async (controller: Controller, request: RuleFileRequest): Promise<RuleFile> => {
	if (
		typeof request.isGlobal !== "boolean" ||
		!request.filename ||
		typeof request.filename !== "string" ||
		!request.type ||
		typeof request.type !== "string"
	) {
		console.error("createRuleFile: Missing or invalid parameters", {
			isGlobal: typeof request.isGlobal === "boolean" ? request.isGlobal : `Invalid: ${typeof request.isGlobal}`,
			filename: typeof request.filename === "string" ? request.filename : `Invalid: ${typeof request.filename}`,
			type: typeof request.type === "string" ? request.type : `Invalid: ${typeof request.type}`,
		})
		throw new Error("Missing or invalid parameters")
	}

	const cwd = await getCwd(getDesktopDir())
	const { filePath, fileExists } = await createRuleFileImpl(request.isGlobal, request.filename, cwd, request.type)

	if (!filePath) {
		throw new Error("Failed to create file.")
	}

	const fileTypeName = request.type === "workflow" ? "workflow" : "rule"

	if (fileExists) {
		vscode.window.showWarningMessage(`${fileTypeName} file "${request.filename}" already exists.`)
		// Still open it for editing
		await handleFileServiceRequest(controller, "openFile", { value: filePath })
	} else {
		if (request.type === "workflow") {
			await refreshWorkflowToggles(controller.context, cwd)
		} else {
			await refreshClineRulesToggles(controller.context, cwd)
		}
		await controller.postStateToWebview()

		await handleFileServiceRequest(controller, "openFile", { value: filePath })

		vscode.window.showInformationMessage(
			`Created new ${request.isGlobal ? "global" : "workspace"} ${fileTypeName} file: ${request.filename}`,
		)
	}

	return RuleFile.create({
		filePath: filePath,
		displayName: path.basename(filePath),
		alreadyExists: fileExists,
	})
}
