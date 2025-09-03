import { refreshClineRulesToggles } from "@core/context/instructions/user-instructions/cline-rules"
import { createRuleFile as createRuleFileImpl } from "@core/context/instructions/user-instructions/rule-helpers"
import { getWorkspaceBasename } from "@core/workspace"
import { RuleFile, RuleFileRequest } from "@shared/proto/cline/file"
import { refreshWorkflowToggles } from "@/core/context/instructions/user-instructions/workflows"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/host/window"
import { getCwd, getDesktopDir } from "@/utils/path"
import { Controller } from ".."
import { openFile } from "./openFile"

/**
 * Creates a rule file in either global or workspace rules directory
 * @param controller The controller instance
 * @param request The request containing filename and isGlobal flag
 * @returns Result with file path and display name
 * @throws Error if operation fails
 */
export async function createRuleFile(controller: Controller, request: RuleFileRequest): Promise<RuleFile> {
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
		const message = `${fileTypeName} file "${request.filename}" already exists.`
		HostProvider.window.showMessage({
			type: ShowMessageType.WARNING,
			message,
		})
		// Still open it for editing
		await openFile(controller, { value: filePath })
	} else {
		if (request.type === "workflow") {
			await refreshWorkflowToggles(controller, cwd)
		} else {
			await refreshClineRulesToggles(controller, cwd)
		}
		await controller.postStateToWebview()

		await openFile(controller, { value: filePath })

		const message = `Created new ${request.isGlobal ? "global" : "workspace"} ${fileTypeName} file: ${request.filename}`
		HostProvider.window.showMessage({
			type: ShowMessageType.INFORMATION,
			message,
		})
	}

	return RuleFile.create({
		filePath: filePath,
		displayName: getWorkspaceBasename(filePath, "Controller.createRuleFile"),
		alreadyExists: fileExists,
	})
}
