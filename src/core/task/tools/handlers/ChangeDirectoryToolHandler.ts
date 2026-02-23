import { ClineSayTool } from "@shared/ExtensionMessage"
import { ClineDefaultTool } from "@shared/tools"
import * as fs from "fs/promises"
import * as path from "path"
import { ToolUse } from "../../../assistant-message"
import { formatResponse } from "../../../prompts/responses"
import { ToolResponse } from "../.."
import { showNotificationForApproval } from "../../utils"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { ToolResultUtils } from "../utils/ToolResultUtils"

export class ChangeDirectoryToolHandler implements IFullyManagedTool {
	readonly name = ClineDefaultTool.CHANGE_DIRECTORY

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.path}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const targetPath = block.params.path || ""
		const sharedMessageProps: ClineSayTool = {
			tool: "changeDirectory",
			path: uiHelpers.removeClosingTag(block, "path", targetPath),
			content: `Changing working directory to: ${uiHelpers.removeClosingTag(block, "path", targetPath)}`,
			operationIsLocatedInWorkspace: false,
		} satisfies ClineSayTool

		const partialMessage = JSON.stringify(sharedMessageProps)

		await uiHelpers.removeLastPartialMessageIfExistsWithType("ask", "tool")
		await uiHelpers.ask("tool", partialMessage, block.partial).catch(() => {})
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const targetPath: string | undefined = block.params.path

		// Validate required parameters
		if (!targetPath) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "path")
		}

		// Validate path is absolute
		if (!path.isAbsolute(targetPath)) {
			config.taskState.consecutiveMistakeCount++
			return formatResponse.toolError(
				`The path must be an absolute path. Received relative path: "${targetPath}". Please provide the full absolute path to the directory.`,
			)
		}

		// Validate directory exists
		try {
			const stat = await fs.stat(targetPath)
			if (!stat.isDirectory()) {
				config.taskState.consecutiveMistakeCount++
				return formatResponse.toolError(`The path "${targetPath}" exists but is not a directory.`)
			}
		} catch {
			config.taskState.consecutiveMistakeCount++
			return formatResponse.toolError(`The directory "${targetPath}" does not exist.`)
		}

		// Check if we're already in this directory
		if (path.resolve(targetPath) === path.resolve(config.cwd)) {
			config.taskState.consecutiveMistakeCount = 0
			return formatResponse.toolResult(`Already in directory: ${targetPath}`)
		}

		config.taskState.consecutiveMistakeCount = 0

		// Create message for approval
		const sharedMessageProps: ClineSayTool = {
			tool: "changeDirectory",
			path: targetPath,
			content: `Changing working directory from ${config.cwd} to: ${targetPath}`,
			operationIsLocatedInWorkspace: false,
		}
		const completeMessage = JSON.stringify(sharedMessageProps)

		// Check auto-approval
		const autoApproveResult = config.callbacks.shouldAutoApproveTool(this.name)
		const shouldAutoApprove = typeof autoApproveResult === "boolean" ? autoApproveResult : autoApproveResult[0]

		if (shouldAutoApprove) {
			// Auto-approve flow
			await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
			await config.callbacks.say("tool", completeMessage, undefined, undefined, false)
		} else {
			// Manual approval flow
			showNotificationForApproval(
				`Cline wants to change working directory to: ${targetPath}`,
				config.autoApprovalSettings.enableNotifications,
			)
			await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")

			const didApprove = await ToolResultUtils.askApprovalAndPushFeedback("tool", completeMessage, config)
			if (!didApprove) {
				return formatResponse.toolDenied()
			}
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

		// Execute the directory change via the Task callback
		if (!config.callbacks.changeCwd) {
			return formatResponse.toolError(
				"Changing working directory is not supported in this environment. This feature is only available in CLI mode.",
			)
		}

		try {
			await config.callbacks.changeCwd(targetPath)
		} catch (error) {
			return formatResponse.toolError(`Failed to change working directory: ${(error as Error).message}`)
		}

		return formatResponse.toolResult(
			`Successfully changed working directory to: ${targetPath}\n\nNote: All subsequent file operations, terminal commands, and path resolution will use this new directory. Checkpoints have been disabled for this task since the working directory changed.`,
		)
	}
}
