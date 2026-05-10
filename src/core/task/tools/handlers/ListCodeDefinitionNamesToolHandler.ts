import type { ToolUse } from "@core/assistant-message"
import { getWorkspaceBasename, resolveWorkspacePath } from "@core/workspace"
import { parseSourceCodeForDefinitionsTopLevel } from "@services/tree-sitter"
import { getReadablePath, isLocatedInWorkspace } from "@utils/path"
import { formatResponse } from "@/core/prompts/responses"
import { telemetryService } from "@/services/telemetry"
import { AiHydroDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import { showNotificationForApprovalIfAutoApprovalEnabled } from "../../utils"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { ToolResultUtils } from "../utils/ToolResultUtils"

export class ListCodeDefinitionNamesToolHandler implements IFullyManagedTool {
	readonly name = AiHydroDefaultTool.LIST_CODE_DEF

	constructor(private validator: ToolValidator) {}

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.path}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const relPath = block.params.path

		const config = uiHelpers.getConfig()

		// Create and show partial UI message
		const sharedMessageProps = {
			tool: "listCodeDefinitionNames",
			path: getReadablePath(config.cwd, uiHelpers.removeClosingTag(block, "path", relPath)),
			content: "",
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
		const relDirPath: string | undefined = block.params.path

		// Validate required parameters
		const pathValidation = this.validator.assertRequiredParams(block, "path")
		if (!pathValidation.ok) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "path")
		}

		// Resolve the path and execute the parse operation inside a single
		// try/catch so that failures in either step return a graceful tool error
		// instead of crashing the task.
		let absolutePath: string
		let displayPath: string
		let result: string
		try {
			const pathResult = resolveWorkspacePath(config, relDirPath!, "ListCodeDefinitionNamesToolHandler.execute")
			;({ absolutePath, displayPath } =
				typeof pathResult === "string" ? { absolutePath: pathResult, displayPath: relDirPath! } : pathResult)
			result = await parseSourceCodeForDefinitionsTopLevel(absolutePath, config.services.aihydroIgnoreController)
		} catch (error) {
			config.taskState.consecutiveMistakeCount++
			const errorMessage = error instanceof Error ? error.message : String(error)
			return formatResponse.toolError(`Error listing code definitions: ${errorMessage}`)
		}

		// parseSourceCodeForDefinitionsTopLevel returns error strings for file paths
		// and non-existent directories rather than throwing.
		const isErrorResult =
			result.includes("provided path is a file, not a directory") ||
			result.includes("does not exist or you do not have permission")
		if (isErrorResult) {
			config.taskState.consecutiveMistakeCount++
			return formatResponse.toolError(result)
		}

		// Only reset after a successful operation so repeated failures
		// accumulate toward the yolo-mode mistake limit.
		config.taskState.consecutiveMistakeCount = 0

		// Handle approval flow
		const sharedMessageProps = {
			tool: "listCodeDefinitionNames",
			path: getReadablePath(config.cwd, displayPath),
			content: result,
			operationIsLocatedInWorkspace: await isLocatedInWorkspace(relDirPath!),
		}

		const completeMessage = JSON.stringify(sharedMessageProps)

		if (await config.callbacks.shouldAutoApproveToolWithPath(block.name, relDirPath)) {
			// Auto-approval flow
			await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
			await config.callbacks.say("tool", completeMessage, undefined, undefined, false)
			if (!config.yoloModeToggled) {
				config.taskState.consecutiveAutoApprovedRequestsCount++
			}

			// Capture telemetry
			telemetryService.captureToolUsage(config.ulid, block.name, config.api.getModel().id, true, true)
		} else {
			// Manual approval flow
			const notificationMessage = `AI-Hydro wants to analyze code definitions in ${getWorkspaceBasename(absolutePath, "ListCodeDefinitionNamesToolHandler.notification")}`

			// Show notification
			showNotificationForApprovalIfAutoApprovalEnabled(
				notificationMessage,
				config.autoApprovalSettings.enabled,
				config.autoApprovalSettings.enableNotifications,
			)

			await config.callbacks.removeLastPartialMessageIfExistsWithType("say", "tool")

			const didApprove = await ToolResultUtils.askApprovalAndPushFeedback("tool", completeMessage, config)
			if (!didApprove) {
				telemetryService.captureToolUsage(config.ulid, block.name, config.api.getModel().id, false, false)
				return formatResponse.toolDenied()
			} else {
				telemetryService.captureToolUsage(config.ulid, block.name, config.api.getModel().id, false, true)
			}
		}

		return result
	}
}
