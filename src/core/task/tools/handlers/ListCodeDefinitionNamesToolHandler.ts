import type { ToolUse } from "@core/assistant-message"
import { getWorkspaceBasename, resolveWorkspacePath } from "@core/workspace"
import { parseSourceCodeForDefinitionsTopLevel } from "@services/tree-sitter"
import { getReadablePath, isLocatedInWorkspace } from "@utils/path"
import { formatResponse } from "@/core/prompts/responses"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { ToolHookUtils } from "../utils/ToolHookUtils"
import { ToolResultUtils } from "../utils/ToolResultUtils"

export class ListCodeDefinitionNamesToolHandler implements IFullyManagedTool {
	readonly name = ClineDefaultTool.LIST_CODE_DEF

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

		config.taskState.consecutiveMistakeCount = 0

		// Resolve the absolute path based on multi-workspace configuration
		const pathResult = resolveWorkspacePath(config, relDirPath!, "ListCodeDefinitionNamesToolHandler.execute")
		const { absolutePath, displayPath } =
			typeof pathResult === "string" ? { absolutePath: pathResult, displayPath: relDirPath! } : pathResult

		// Execute the actual parse source code operation
		const result = await parseSourceCodeForDefinitionsTopLevel(absolutePath, config.services.clineIgnoreController)

		// Handle approval flow
		const sharedMessageProps = {
			tool: "listCodeDefinitionNames",
			path: getReadablePath(config.cwd, displayPath),
			content: result,
			operationIsLocatedInWorkspace: await isLocatedInWorkspace(relDirPath!),
		}

		const completeMessage = JSON.stringify(sharedMessageProps)

		if (await config.callbacks.shouldAutoApproveToolWithPath(block.name, relDirPath)) {
			// Auto-approval flow - Standard pattern for approved tools:
			// 1. Clean up partial messages and send the complete tool message
			// 2. Record telemetry for the auto-approved tool execution
			await ToolResultUtils.cleanupAndSendToolMessage(config, "tool", completeMessage)
			ToolResultUtils.captureAutoApprovedTool(config, block)
		} else {
			// Manual approval flow - Standard pattern for tools requiring approval:
			// 1. Show notification to user
			// 2. Clean up any partial messages from the UI
			// 3. Ask for approval and handle any user feedback
			// 4. Handle approval result with telemetry and return early if denied
			ToolResultUtils.showToolNotification(
				`Cline wants to analyze code definitions in ${getWorkspaceBasename(absolutePath, "ListCodeDefinitionNamesToolHandler.notification")}`,
				config.autoApprovalSettings.enableNotifications,
			)
			await config.callbacks.removeLastPartialMessageIfExistsWithType("say", "tool")
			const { didApprove } = await ToolResultUtils.askToolApproval(config, "tool", completeMessage)

			const result = ToolResultUtils.handleApprovalResult(didApprove, config, block)
			if (result) return result
		}

		// Run PreToolUse hook after approval
		const shouldContinue = await ToolHookUtils.runPreToolUseIfEnabled(config, block)
		if (!shouldContinue) {
			return formatResponse.toolCancelled()
		}

		return result
	}
}
