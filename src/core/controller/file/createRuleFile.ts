import { Controller } from ".."
import { RuleFileRequest, RuleFile } from "@shared/proto/file"
import { FileMethodHandler } from "./index"
import {
	createRuleFile as createRuleFileImpl,
	refreshClineRulesToggles,
} from "@core/context/instructions/user-instructions/cline-rules"
import * as vscode from "vscode"
import * as path from "path"
import { handleFileServiceRequest } from "./index"
import { cwd } from "@core/task"

/**
 * Creates a rule file in either global or workspace rules directory
 * @param controller The controller instance
 * @param request The request containing filename and isGlobal flag
 * @returns Result with file path and display name
 * @throws Error if operation fails
 */
export const createRuleFile: FileMethodHandler = async (controller: Controller, request: RuleFileRequest): Promise<RuleFile> => {
	if (typeof request.isGlobal !== "boolean" || typeof request.filename !== "string" || !request.filename) {
		console.error("createRuleFile: Missing or invalid parameters", {
			isGlobal: typeof request.isGlobal === "boolean" ? request.isGlobal : `Invalid: ${typeof request.isGlobal}`,
			filename: typeof request.filename === "string" ? request.filename : `Invalid: ${typeof request.filename}`,
		})
		throw new Error("Missing or invalid parameters")
	}

	const { filePath, fileExists } = await createRuleFileImpl(request.isGlobal, request.filename, cwd)

	if (!filePath) {
		throw new Error("Failed to create rule file.")
	}

	if (fileExists) {
		vscode.window.showWarningMessage(`Rule file "${request.filename}" already exists.`)
		// Still open it for editing
		await handleFileServiceRequest(controller, "openFile", { value: filePath })
	} else {
		await refreshClineRulesToggles(controller.context, cwd)
		await controller.postStateToWebview()

		await handleFileServiceRequest(controller, "openFile", { value: filePath })

		vscode.window.showInformationMessage(
			`Created new ${request.isGlobal ? "global" : "workspace"} rule file: ${request.filename}`,
		)
	}

	return RuleFile.create({
		filePath: filePath,
		displayName: path.basename(filePath),
		alreadyExists: fileExists,
	})
}
