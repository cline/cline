import path from "node:path"
import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { getWorkspaceBasename, resolveWorkspacePath } from "@core/workspace"
import { listFiles } from "@services/glob/list-files"
import { arePathsEqual, getReadablePath, isLocatedInWorkspace } from "@utils/path"
import { telemetryService } from "@/services/telemetry"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import { showNotificationForApproval } from "../../utils"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { ToolResultUtils } from "../utils/ToolResultUtils"

export class ListFilesToolHandler implements IFullyManagedTool {
	readonly name = ClineDefaultTool.LIST_FILES

	constructor(private validator: ToolValidator) {}

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.path}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const relPath = block.params.path

		// Get config access for services
		const config = uiHelpers.getConfig()
		if (config.isSubagentExecution) {
			return
		}

		// Create and show partial UI message
		const recursiveRaw = block.params.recursive
		const recursive = recursiveRaw?.toLowerCase() === "true"
		const sharedMessageProps = {
			tool: recursive ? "listFilesRecursive" : "listFilesTopLevel",
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
		const recursiveRaw: string | undefined = block.params.recursive
		const recursive = recursiveRaw?.toLowerCase() === "true"

		// Extract provider using the proven pattern from ReportBugHandler
		const apiConfig = config.services.stateManager.getApiConfiguration()
		const currentMode = config.services.stateManager.getGlobalSettingsKey("mode")
		const provider = (currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string

		// Validate required parameters
		const pathValidation = this.validator.assertRequiredParams(block, "path")
		if (!pathValidation.ok) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "path")
		}

		// Check clineignore access before performing any IO
		const accessValidation = this.validator.checkClineIgnorePath(relDirPath!)
		if (!accessValidation.ok) {
			if (!config.isSubagentExecution) {
				await config.callbacks.say("clineignore_error", relDirPath)
			}
			return formatResponse.toolError(formatResponse.clineIgnoreError(relDirPath!))
		}

		// Resolve the path and execute the list operation inside a single
		// try/catch so that failures in either step (e.g. bad workspace hint,
		// non-existent directory) return a graceful tool error instead of
		// crashing the task.
		let absolutePath: string
		let displayPath: string
		let files: string[]
		let didHitLimit: boolean
		let usedWorkspaceHint: boolean
		try {
			const pathResult = resolveWorkspacePath(config, relDirPath!, "ListFilesToolHandler.execute")
			;({ absolutePath, displayPath } =
				typeof pathResult === "string" ? { absolutePath: pathResult, displayPath: relDirPath! } : pathResult)
			usedWorkspaceHint = typeof pathResult !== "string"
			;[files, didHitLimit] = await listFiles(absolutePath, recursive, 200)
		} catch (error) {
			config.taskState.consecutiveMistakeCount++
			const errorMessage = error instanceof Error ? error.message : String(error)
			return formatResponse.toolError(`Error listing files: ${errorMessage}`)
		}

		// Only reset after all validations and the core operation succeed so
		// repeated failures accumulate toward the yolo-mode mistake limit.
		config.taskState.consecutiveMistakeCount = 0

		// Determine workspace context for telemetry
		const fallbackAbsolutePath = path.resolve(config.cwd, relDirPath ?? "")
		const workspaceContext = {
			isMultiRootEnabled: config.isMultiRootEnabled || false,
			usedWorkspaceHint,
			resolvedToNonPrimary: !arePathsEqual(absolutePath, fallbackAbsolutePath),
			resolutionMethod: (usedWorkspaceHint ? "hint" : "primary_fallback") as "hint" | "primary_fallback",
		}

		const result = formatResponse.formatFilesList(absolutePath, files, didHitLimit, config.services.clineIgnoreController)

		// Handle approval flow
		const sharedMessageProps = {
			tool: recursive ? "listFilesRecursive" : "listFilesTopLevel",
			path: getReadablePath(config.cwd, displayPath),
			content: result,
			operationIsLocatedInWorkspace: await isLocatedInWorkspace(relDirPath!),
		}

		const completeMessage = JSON.stringify(sharedMessageProps)

		const shouldAutoApprove =
			config.isSubagentExecution || (await config.callbacks.shouldAutoApproveToolWithPath(block.name, relDirPath))
		if (shouldAutoApprove) {
			// Auto-approval flow
			if (!config.isSubagentExecution) {
				await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
				await config.callbacks.say("tool", completeMessage, undefined, undefined, false)
			}

			// Capture telemetry
			telemetryService.captureToolUsage(
				config.ulid,
				block.name,
				config.api.getModel().id,
				provider,
				true,
				true,
				workspaceContext,
				block.isNativeToolCall,
			)
		} else {
			// Manual approval flow
			const notificationMessage = `Cline wants to view directory ${getWorkspaceBasename(absolutePath, "ListFilesToolHandler.notification")}/`

			// Show notification
			showNotificationForApproval(notificationMessage, config.autoApprovalSettings.enableNotifications)

			await config.callbacks.removeLastPartialMessageIfExistsWithType("say", "tool")

			const didApprove = await ToolResultUtils.askApprovalAndPushFeedback("tool", completeMessage, config)
			if (!didApprove) {
				telemetryService.captureToolUsage(
					config.ulid,
					block.name,
					config.api.getModel().id,
					provider,
					false,
					false,
					workspaceContext,
					block.isNativeToolCall,
				)
				return formatResponse.toolDenied()
			}
			telemetryService.captureToolUsage(
				config.ulid,
				block.name,
				config.api.getModel().id,
				provider,
				false,
				true,
				workspaceContext,
				block.isNativeToolCall,
			)
		}

		// Run PreToolUse hook after approval but before execution
		try {
			const { ToolHookUtils } = await import("../utils/ToolHookUtils")
			await ToolHookUtils.runPreToolUseIfEnabled(config, block)
		} catch (error) {
			const { PreToolUseHookCancellationError } = await import("@core/hooks/PreToolUseHookCancellationError")
			if (error instanceof PreToolUseHookCancellationError) {
				return formatResponse.toolDenied()
			}
			throw error
		}

		return result
	}
}
