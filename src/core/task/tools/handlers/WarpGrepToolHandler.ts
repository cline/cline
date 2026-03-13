import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@/core/prompts/responses"
import { executeWarpGrepSearch } from "@/services/warpgrep"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import { showNotificationForApproval } from "../../utils"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { ToolResultUtils } from "../utils/ToolResultUtils"

export class WarpGrepToolHandler implements IFullyManagedTool {
	readonly name = ClineDefaultTool.WARPGREP

	getDescription(block: ToolUse): string {
		return `[warpgrep_codebase_search for '${block.params.query}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const config = uiHelpers.getConfig()
		if (config.isSubagentExecution) {
			return
		}

		const query = block.params.query
		const sharedMessageProps = {
			tool: "searchFiles" as const,
			path: config.cwd,
			content: "",
			regex: uiHelpers.removeClosingTag(block, "query", query),
		}

		const partialMessage = JSON.stringify(sharedMessageProps)

		if (await uiHelpers.shouldAutoApproveToolWithPath(block.name, config.cwd)) {
			await uiHelpers.removeLastPartialMessageIfExistsWithType("ask", "tool")
			await uiHelpers.say("tool", partialMessage, undefined, undefined, block.partial)
		} else {
			await uiHelpers.removeLastPartialMessageIfExistsWithType("say", "tool")
			await uiHelpers.ask("tool", partialMessage, block.partial).catch(() => {})
		}
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const query: string | undefined = block.params.query

		// Validate required parameters
		if (!query) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "query")
		}

		// Check if warpGrep is enabled
		const warpGrepEnabled = config.services.stateManager.getGlobalSettingsKey("warpGrepEnabled")
		if (!warpGrepEnabled) {
			return "WarpGrep is not enabled. Please enable it in settings and provide a WarpGrep API key."
		}

		config.taskState.consecutiveMistakeCount = 0

		const sharedMessageProps = {
			tool: "searchFiles" as const,
			path: config.cwd,
			content: "",
			regex: query,
		}

		const shouldAutoApprove =
			config.isSubagentExecution || (await config.callbacks.shouldAutoApproveToolWithPath(block.name, config.cwd))

		if (shouldAutoApprove) {
			if (!config.isSubagentExecution) {
				await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
				await config.callbacks.say("tool", JSON.stringify(sharedMessageProps), undefined, undefined, false)
			}
		} else {
			const notificationMessage = `Cline wants to search codebase for: ${query}`
			showNotificationForApproval(notificationMessage, config.autoApprovalSettings.enableNotifications)

			await config.callbacks.removeLastPartialMessageIfExistsWithType("say", "tool")
			const didApprove = await ToolResultUtils.askApprovalAndPushFeedback(
				"tool",
				JSON.stringify(sharedMessageProps),
				config,
			)
			if (!didApprove) {
				return formatResponse.toolDenied()
			}
		}

		// Run PreToolUse hook
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

		// Get API key from secrets
		const apiKey = config.services.stateManager.getSecretKey("warpGrepApiKey")
		if (!apiKey) {
			return "WarpGrep API key is not configured. Please add your WarpGrep API key in settings."
		}

		// Execute the WarpGrep search
		const result = await executeWarpGrepSearch(cwd(config), query, apiKey, config.services.clineIgnoreController)

		if (!result.success) {
			return `WarpGrep search failed: ${result.error || "Unknown error"}`
		}

		// Update the message with results
		if (!config.isSubagentExecution) {
			const completeProps = {
				...sharedMessageProps,
				content: result.content,
			}
			await config.callbacks.say("tool", JSON.stringify(completeProps), undefined, undefined, false)
		}

		return result.content
	}
}

function cwd(config: TaskConfig): string {
	return config.cwd
}
