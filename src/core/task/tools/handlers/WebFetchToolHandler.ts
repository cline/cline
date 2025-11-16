import { ClineAsk, ClineSayTool } from "@shared/ExtensionMessage"
import { ClineDefaultTool } from "@shared/tools"
import axios from "axios"
import { ClineEnv } from "@/config"
import { AuthService } from "@/services/auth/AuthService"
import { buildClineExtraHeaders } from "@/services/EnvUtils"
import { telemetryService } from "@/services/telemetry"
import { CLINE_ACCOUNT_AUTH_ERROR_MESSAGE } from "@/shared/ClineAccount"
import { getAxiosSettings } from "@/shared/net"
import { ToolUse } from "../../../assistant-message"
import { formatResponse } from "../../../prompts/responses"
import { ToolResponse } from "../.."
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

export class WebFetchToolHandler implements IFullyManagedTool {
	readonly name = ClineDefaultTool.WEB_FETCH

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.url}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const url = block.params.url || ""
		const prompt = block.params.prompt || ""

		const sharedMessageProps: ClineSayTool = {
			tool: "webFetch",
			path: uiHelpers.removeClosingTag(block, "url", url),
			content: `Fetching URL: ${uiHelpers.removeClosingTag(block, "url", url)}\nPrompt: ${uiHelpers.removeClosingTag(block, "prompt", prompt)}`,
			operationIsLocatedInWorkspace: false, // web_fetch is always external
		} satisfies ClineSayTool

		const partialMessage = JSON.stringify(sharedMessageProps)

		await uiHelpers.removeLastPartialMessageIfExistsWithType("say", "tool")
		await uiHelpers.ask("tool" as ClineAsk, partialMessage, block.partial).catch(() => {})
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		try {
			const url: string | undefined = block.params.url
			const prompt: string | undefined = block.params.prompt

			// Extract provider information for validation and telemetry
			const apiConfig = config.services.stateManager.getApiConfiguration()
			const currentMode = config.services.stateManager.getGlobalSettingsKey("mode")
			const provider = (currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string

			// Ensure feature is enabled
			const clineWebToolsEnabled = config.services.stateManager.getGlobalSettingsKey("clineWebToolsEnabled")
			if (provider !== "cline" || !clineWebToolsEnabled) {
				return formatResponse.toolError("Cline web tools are currently disabled.")
			}

			if (!url) {
				config.taskState.consecutiveMistakeCount++
				return await config.callbacks.sayAndCreateMissingParamError(this.name, "url")
			}

			if (!prompt) {
				config.taskState.consecutiveMistakeCount++
				return await config.callbacks.sayAndCreateMissingParamError(this.name, "prompt")
			}

			config.taskState.consecutiveMistakeCount = 0

			// Create message for approval
			const sharedMessageProps: ClineSayTool = {
				tool: "webFetch",
				path: url,
				content: `Fetching URL: ${url}\nPrompt: ${prompt}`,
				operationIsLocatedInWorkspace: false,
			}
			const completeMessage = JSON.stringify(sharedMessageProps)

			// Web tools are toggleable, so not checking approvals
			await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
			await config.callbacks.say("tool", completeMessage, undefined, undefined, false)

			telemetryService.captureToolUsage(
				config.ulid,
				"web_fetch",
				config.api.getModel().id,
				provider,
				true, // autoApproved
				true, // didUserApprove
				undefined,
				block.isNativeToolCall,
			)

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

			// Execute the actual fetch
			const baseUrl = ClineEnv.config().apiBaseUrl
			const authToken = await AuthService.getInstance().getAuthToken()

			if (!authToken) {
				throw new Error(CLINE_ACCOUNT_AUTH_ERROR_MESSAGE)
			}

			const response = await axios.post(
				`${baseUrl}/api/v1/search/webfetch`,
				{
					Url: url,
					Prompt: prompt,
				},
				{
					headers: {
						Authorization: `Bearer ${authToken}`,
						"Content-Type": "application/json",
						...(await buildClineExtraHeaders()),
					},
					timeout: 15000,
					...getAxiosSettings(),
				},
			)

			// Parse response
			// Axios will throw on non-200 status, so no need to check fetchStatus
			const result = response.data.data.result

			return formatResponse.toolResult(result)
		} catch (error) {
			return `Error fetching web content: ${(error as Error).message}`
		}
	}
}
