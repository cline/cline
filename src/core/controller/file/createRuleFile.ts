import { Controller } from ".."
import { CreateRuleFileRequest, CreateRuleFileResponse } from "@shared/proto/file"
import { FileMethodHandler } from "./index"
import {
	createRuleFile as createRuleFileImpl,
	refreshClineRulesToggles,
} from "@core/context/instructions/user-instructions/cline-rules"
import * as vscode from "vscode"
import { handleFileServiceRequest } from "./index"
import { cwd } from "@core/task"

/**
 * Creates a rule file in either global or workspace rules directory
 * @param controller The controller instance
 * @param request The request containing filename and isGlobal flag
 * @returns Response with file path and exists status
 */
export const createRuleFile: FileMethodHandler = async (
	controller: Controller,
	request: CreateRuleFileRequest,
): Promise<CreateRuleFileResponse> => {
	if (typeof request.isGlobal !== "boolean" || typeof request.filename !== "string" || !request.filename) {
		console.error("createRuleFile: Missing or invalid parameters", {
			isGlobal: typeof request.isGlobal === "boolean" ? request.isGlobal : `Invalid: ${typeof request.isGlobal}`,
			filename: typeof request.filename === "string" ? request.filename : `Invalid: ${typeof request.filename}`,
		})
		return CreateRuleFileResponse.create({
			filePath: "",
			fileExists: false,
		})
	}

	const { filePath, fileExists } = await createRuleFileImpl(request.isGlobal, request.filename, cwd)

	if (fileExists && filePath) {
		vscode.window.showWarningMessage(`Rule file "${request.filename}" already exists.`)
		// Still open it for editing
		await handleFileServiceRequest(controller, "openFile", { value: filePath })
	} else if (filePath && !fileExists) {
		await refreshClineRulesToggles(controller.context, cwd)
		await controller.postStateToWebview()

		await handleFileServiceRequest(controller, "openFile", { value: filePath })

		vscode.window.showInformationMessage(
			`Created new ${request.isGlobal ? "global" : "workspace"} rule file: ${request.filename}`,
		)
	} else {
		// null filePath
		vscode.window.showErrorMessage(`Failed to create rule file.`)
	}

	return CreateRuleFileResponse.create({
		filePath: filePath || "",
		fileExists: !!fileExists,
	})
}
