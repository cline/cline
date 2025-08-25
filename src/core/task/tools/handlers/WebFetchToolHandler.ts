import { UrlContentFetcher } from "@services/browser/UrlContentFetcher"
import { telemetryService } from "@services/posthog/PostHogClientProvider"
import { ClineAsk, ClineSayTool } from "@shared/ExtensionMessage"
import { ToolUse, ToolUseName } from "../../../assistant-message"
import { formatResponse } from "../../../prompts/responses"
import { ToolResponse } from "../.."
import { showNotificationForApprovalIfAutoApprovalEnabled } from "../../utils"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

export class WebFetchToolHandler implements IFullyManagedTool {
	name = "web_fetch"
	supportedTools: ToolUseName[] = ["web_fetch"]

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		// For partial blocks, don't execute yet
		if (block.partial) {
			return ""
		}

		try {
			const url: string | undefined = block.params.url

			// Validate required parameter
			if (!url) {
				config.taskState.consecutiveMistakeCount++
				return await config.callbacks.sayAndCreateMissingParamError("web_fetch", "url")
			}
			config.taskState.consecutiveMistakeCount = 0

			// Create message for approval
			const sharedMessageProps: ClineSayTool = {
				tool: "webFetch",
				path: url,
				content: `Fetching URL: ${url}`,
				operationIsLocatedInWorkspace: false,
			}
			const completeMessage = JSON.stringify(sharedMessageProps)

			// Check auto-approval (web_fetch uses simple boolean, not array)
			const autoApprove = config.autoApprovalSettings.enabled && config.autoApprovalSettings.actions.useBrowser

			if (autoApprove) {
				// Auto-approve flow
				await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
				await config.callbacks.say("tool", completeMessage, undefined, undefined, false)
				config.taskState.consecutiveAutoApprovedRequestsCount++
				telemetryService.captureToolUsage(config.ulid, "web_fetch", config.api.getModel().id, true, true)
			} else {
				// Manual approval flow
				showNotificationForApprovalIfAutoApprovalEnabled(
					`Cline wants to fetch content from ${url}`,
					config.autoApprovalSettings.enabled,
					config.autoApprovalSettings.enableNotifications,
				)
				await config.callbacks.removeLastPartialMessageIfExistsWithType("say", "tool")

				const { response } = await config.callbacks.ask("tool", completeMessage, false)
				if (response !== "yesButtonClicked") {
					telemetryService.captureToolUsage(config.ulid, "web_fetch", config.api.getModel().id, false, false)
					return "The user denied this operation."
				}
				telemetryService.captureToolUsage(config.ulid, "web_fetch", config.api.getModel().id, false, true)
			}

			// Execute the actual fetch
			const urlContentFetcher = config.services?.urlContentFetcher as UrlContentFetcher

			await urlContentFetcher.launchBrowser()
			try {
				// Fetch Markdown content
				const markdownContent = await urlContentFetcher.urlToMarkdown(url)

				// TODO: Implement secondary AI call to process markdownContent with prompt
				// For now, returning markdown directly.
				// This will be a significant sub-task.
				// Placeholder for processed summary:
				const processedSummary = `Fetched Markdown for ${url}:\n\n${markdownContent}`

				return formatResponse.toolResult(processedSummary)
			} finally {
				// Ensure browser is closed even on error
				await urlContentFetcher.closeBrowser()
			}
		} catch (error) {
			return `Error fetching web content: ${(error as Error).message}`
		}
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const url = block.params.url || ""
		const sharedMessageProps: ClineSayTool = {
			tool: "webFetch",
			path: uiHelpers.removeClosingTag(block, "url", url),
			content: `Fetching URL: ${uiHelpers.removeClosingTag(block, "url", url)}`,
			operationIsLocatedInWorkspace: false, // web_fetch is always external
		}

		const partialMessage = JSON.stringify(sharedMessageProps)

		// For partial blocks, we'll let the ToolExecutor handle auto-approval logic
		// Just stream the UI update for now
		await uiHelpers.removeLastPartialMessageIfExistsWithType("say", "tool")
		await uiHelpers.ask("tool" as ClineAsk, partialMessage, block.partial).catch(() => {})
	}
}
