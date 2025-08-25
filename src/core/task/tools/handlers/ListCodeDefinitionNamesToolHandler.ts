import type { ToolUse } from "@core/assistant-message"
import { telemetryService } from "@services/posthog/PostHogClientProvider"
import { parseSourceCodeForDefinitionsTopLevel } from "@services/tree-sitter"
import { getReadablePath, isLocatedInWorkspace } from "@utils/path"
import * as path from "path"
import type { ToolResponse } from "../../index"
import { showNotificationForApprovalIfAutoApprovalEnabled } from "../../utils"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

export class ListCodeDefinitionNamesToolHandler implements IFullyManagedTool {
	readonly name = "list_code_definition_names"

	constructor(private validator: ToolValidator) {}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const relPath = block.params.path

		// Early return if we don't have enough data yet
		if (!relPath) {
			return
		}

		// Get config access for services
		const config = uiHelpers.getConfig()

		// Create and show partial UI message
		const absolutePath = path.resolve(config.cwd, relPath)
		const sharedMessageProps = {
			tool: "listCodeDefinitionNames",
			path: getReadablePath(config.cwd, uiHelpers.removeClosingTag(block, "path", relPath)),
			content: absolutePath,
			operationIsLocatedInWorkspace: await isLocatedInWorkspace(relPath),
		}

		const partialMessage = JSON.stringify(sharedMessageProps)

		// Handle auto-approval vs manual approval for partial
		if (await uiHelpers.shouldAutoApproveToolWithPath(block.name, relPath)) {
			await uiHelpers.removeLastPartialMessageIfExistsWithType("ask", "tool")
			await uiHelpers.say("tool", partialMessage, undefined, undefined, block.partial)
		} else {
			await uiHelpers.removeLastPartialMessageIfExistsWithType("say", "tool")
			await uiHelpers.ask("tool", partialMessage, block.partial).catch(() => {})
		}
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		// For partial blocks, return empty string to let coordinator handle UI
		if (block.partial) {
			return ""
		}

		const relDirPath: string | undefined = block.params.path

		// Validate required parameters
		const pathValidation = this.validator.assertRequiredParams(block, "path")
		if (!pathValidation.ok) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError("list_code_definition_names", "path")
		}

		config.taskState.consecutiveMistakeCount = 0
		const absolutePath = path.resolve(config.cwd, relDirPath!)

		// Handle approval flow
		const sharedMessageProps = {
			tool: "listCodeDefinitionNames",
			path: getReadablePath(config.cwd, relDirPath!),
			content: absolutePath,
			operationIsLocatedInWorkspace: await isLocatedInWorkspace(relDirPath!),
		}

		const completeMessage = JSON.stringify(sharedMessageProps)

		if (await config.callbacks.shouldAutoApproveToolWithPath(block.name, relDirPath)) {
			// Auto-approval flow
			await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
			await config.callbacks.say("tool", completeMessage, undefined, undefined, false)
			config.taskState.consecutiveAutoApprovedRequestsCount++

			// Capture telemetry
			telemetryService.captureToolUsage(config.ulid, block.name, config.api.getModel().id, true, true)
		} else {
			// Manual approval flow
			const notificationMessage = `Cline wants to analyze code definitions in ${path.basename(absolutePath)}`

			// Show notification
			showNotificationForApprovalIfAutoApprovalEnabled(
				notificationMessage,
				config.autoApprovalSettings.enabled,
				config.autoApprovalSettings.enableNotifications,
			)

			await config.callbacks.removeLastPartialMessageIfExistsWithType("say", "tool")

			// Ask for approval
			const { response } = await config.callbacks.ask("tool", completeMessage, false)

			if (response !== "yesButtonClicked") {
				// Handle rejection
				config.taskState.didRejectTool = true
				telemetryService.captureToolUsage(config.ulid, block.name, config.api.getModel().id, false, false)
				return "The user denied this operation."
			} else {
				telemetryService.captureToolUsage(config.ulid, block.name, config.api.getModel().id, false, true)
			}
		}

		// Execute the actual parse source code operation
		const result = await parseSourceCodeForDefinitionsTopLevel(absolutePath, config.services.clineIgnoreController)

		return result
	}
}
