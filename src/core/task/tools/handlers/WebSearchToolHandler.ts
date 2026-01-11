import { ClineAsk, ClineSayTool } from "@shared/ExtensionMessage"
import { ClineDefaultTool } from "@shared/tools"
import axios from "axios"
import { ClineEnv } from "@/config"
import { AuthService } from "@/services/auth/AuthService"
import { buildClineExtraHeaders } from "@/services/EnvUtils"
import { featureFlagsService } from "@/services/feature-flags"
import { telemetryService } from "@/services/telemetry"
import { parsePartialArrayString } from "@/shared/array"
import { CLINE_ACCOUNT_AUTH_ERROR_MESSAGE } from "@/shared/ClineAccount"
import { getAxiosSettings } from "@/shared/net"
import { ToolUse } from "../../../assistant-message"
import { formatResponse } from "../../../prompts/responses"
import { ToolResponse } from "../.."
import { showNotificationForApproval } from "../../utils"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { ToolResultUtils } from "../utils/ToolResultUtils"

export class WebSearchToolHandler implements IFullyManagedTool {
	readonly name = ClineDefaultTool.WEB_SEARCH

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.query}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const query = block.params.query || ""
		const sharedMessageProps: ClineSayTool = {
			tool: "webSearch",
			path: uiHelpers.removeClosingTag(block, "query", query),
			content: `Searching for: ${uiHelpers.removeClosingTag(block, "query", query)}`,
			operationIsLocatedInWorkspace: false, // web_search is always external
		} satisfies ClineSayTool

		const partialMessage = JSON.stringify(sharedMessageProps)

		// For partial blocks, we'll let the ToolExecutor handle auto-approval logic
		// Just stream the UI update for now
		await uiHelpers.removeLastPartialMessageIfExistsWithType("say", "tool")
		await uiHelpers.ask("tool" as ClineAsk, partialMessage, block.partial).catch(() => {})
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		try {
			const query: string | undefined = block.params.query
			const allowedDomainsRaw: string | undefined = block.params.allowed_domains
			const blockedDomainsRaw: string | undefined = block.params.blocked_domains

			// Extract provider information for telemetry
			const apiConfig = config.services.stateManager.getApiConfiguration()
			const currentMode = config.services.stateManager.getGlobalSettingsKey("mode")
			const provider = (currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string

			// Check if Cline web tools are enabled (both user setting and feature flag)
			const clineWebToolsEnabled = config.services.stateManager.getGlobalSettingsKey("clineWebToolsEnabled")
			const featureFlagEnabled = featureFlagsService.getWebtoolsEnabled()
			if (provider !== "cline" || !clineWebToolsEnabled || !featureFlagEnabled) {
				return formatResponse.toolError("Cline web tools are currently disabled.")
			}

			// Validate required parameters
			if (!query) {
				config.taskState.consecutiveMistakeCount++
				return await config.callbacks.sayAndCreateMissingParamError(this.name, "query")
			}
			config.taskState.consecutiveMistakeCount = 0

			// Parse domain arrays
			const allowedDomains = parsePartialArrayString(allowedDomainsRaw || "[]")
			const blockedDomains = parsePartialArrayString(blockedDomainsRaw || "[]")

			// Validate mutual exclusivity
			if (allowedDomains.length > 0 && blockedDomains.length > 0) {
				config.taskState.consecutiveMistakeCount++
				return formatResponse.toolError("Cannot specify both allowed_domains and blocked_domains")
			}

			// Create message for approval
			const sharedMessageProps: ClineSayTool = {
				tool: "webSearch",
				path: query,
				content: `Searching for: ${query}`,
				operationIsLocatedInWorkspace: false,
			}
			const completeMessage = JSON.stringify(sharedMessageProps)

			if (config.callbacks.shouldAutoApproveTool(this.name)) {
				// Auto-approve flow
				await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
				await config.callbacks.say("tool", completeMessage, undefined, undefined, false)
				telemetryService.captureToolUsage(
					config.ulid,
					"web_search",
					config.api.getModel().id,
					provider,
					true,
					true,
					undefined,
					block.isNativeToolCall,
				)
			} else {
				// Manual approval flow
				showNotificationForApproval(
					`Cline wants to search for: ${query}`,
					config.autoApprovalSettings.enableNotifications,
				)
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
						undefined,
						block.isNativeToolCall,
					)
					return formatResponse.toolDenied()
				} else {
					telemetryService.captureToolUsage(
						config.ulid,
						block.name,
						config.api.getModel().id,
						provider,
						false,
						true,
						undefined,
						block.isNativeToolCall,
					)
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

			// Execute the actual search
			const baseUrl = ClineEnv.config().apiBaseUrl
			const authToken = await AuthService.getInstance().getAuthToken()

			if (!authToken) {
				throw new Error(CLINE_ACCOUNT_AUTH_ERROR_MESSAGE)
			}

			const requestBody: {
				query: string
				allowed_domains?: string[]
				blocked_domains?: string[]
			} = {
				query: query,
			}

			// Only include domain filters if they have values
			if (allowedDomains.length > 0) {
				requestBody.allowed_domains = allowedDomains
			}
			if (blockedDomains.length > 0) {
				requestBody.blocked_domains = blockedDomains
			}

			const response = await axios.post(`${baseUrl}/api/v1/search/websearch`, requestBody, {
				headers: {
					Authorization: `Bearer ${authToken}`,
					"Content-Type": "application/json",
					"X-Task-ID": config.ulid || "",
					...(await buildClineExtraHeaders()),
				},
				timeout: 15000,
				...getAxiosSettings(),
			})

			// Parse response
			// Axios will throw on non-200 status, so no need to check fetchStatus
			const data = response.data.data

			// Format results for display
			const results = data.results || []
			const resultCount = results.length

			let resultText = `Search completed (${resultCount} results found)`
			if (results.length > 0) {
				resultText += ":\n\n"
				results.forEach((result: { title: string; url: string }, index: number) => {
					resultText += `${index + 1}. ${result.title}\n   ${result.url}\n\n`
				})
			}

			return formatResponse.toolResult(resultText)
		} catch (error) {
			return `Error performing web search: ${(error as Error).message}`
		}
	}
}
