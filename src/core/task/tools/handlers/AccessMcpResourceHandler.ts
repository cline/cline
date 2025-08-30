import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { ClineAsk, ClineAskUseMcpServer } from "@shared/ExtensionMessage"
import { telemetryService } from "@/services/telemetry"
import type { ToolResponse } from "../../index"
import { showNotificationForApprovalIfAutoApprovalEnabled } from "../../utils"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { ToolResultUtils } from "../utils/ToolResultUtils"

export class AccessMcpResourceHandler implements IFullyManagedTool {
	readonly name = "access_mcp_resource"

	constructor() {}

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.server_name}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const server_name = block.params.server_name
		const uri = block.params.uri

		const partialMessage = JSON.stringify({
			type: "access_mcp_resource",
			serverName: uiHelpers.removeClosingTag(block, "server_name", server_name),
			toolName: undefined,
			uri: uiHelpers.removeClosingTag(block, "uri", uri),
			arguments: undefined,
		} satisfies ClineAskUseMcpServer)

		// Check if tool should be auto-approved (access_mcp_resource uses general auto-approval)
		const shouldAutoApprove = uiHelpers.shouldAutoApproveTool(block.name)

		if (shouldAutoApprove) {
			await uiHelpers.removeLastPartialMessageIfExistsWithType("ask", "use_mcp_server")
			await uiHelpers.say("use_mcp_server" as any, partialMessage, undefined, undefined, block.partial)
		} else {
			await uiHelpers.removeLastPartialMessageIfExistsWithType("say", "use_mcp_server")
			await uiHelpers.ask("use_mcp_server" as ClineAsk, partialMessage, block.partial).catch(() => {})
		}
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const server_name: string | undefined = block.params.server_name
		const uri: string | undefined = block.params.uri

		// Validate required parameters
		if (!server_name) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError("access_mcp_resource", "server_name")
		}

		if (!uri) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError("access_mcp_resource", "uri")
		}

		config.taskState.consecutiveMistakeCount = 0

		// Handle approval flow
		const completeMessage = JSON.stringify({
			type: "access_mcp_resource",
			serverName: server_name,
			toolName: undefined,
			uri: uri,
			arguments: undefined,
		} satisfies ClineAskUseMcpServer)

		const shouldAutoApprove = config.callbacks.shouldAutoApproveTool(block.name)

		if (shouldAutoApprove) {
			// Auto-approval flow
			await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "use_mcp_server")
			await config.callbacks.say("use_mcp_server", completeMessage, undefined, undefined, false)
			config.taskState.consecutiveAutoApprovedRequestsCount++

			// Capture telemetry
			telemetryService.captureToolUsage(config.ulid, block.name, config.api.getModel().id, true, true)
		} else {
			// Manual approval flow
			const notificationMessage = `Cline wants to access ${uri || "unknown resource"} on ${server_name || "unknown server"}`

			// Show notification
			showNotificationForApprovalIfAutoApprovalEnabled(
				notificationMessage,
				config.autoApprovalSettings.enabled,
				config.autoApprovalSettings.enableNotifications,
			)

			await config.callbacks.removeLastPartialMessageIfExistsWithType("say", "use_mcp_server")

			const didApprove = await ToolResultUtils.askApprovalAndPushFeedback("use_mcp_server", completeMessage, config)
			if (!didApprove) {
				telemetryService.captureToolUsage(config.ulid, block.name, config.api.getModel().id, false, false)
				return formatResponse.toolDenied()
			} else {
				telemetryService.captureToolUsage(config.ulid, block.name, config.api.getModel().id, false, true)
			}
		}

		await config.callbacks.say("mcp_server_request_started")

		// Execute the MCP resource access
		const resourceResult = await config.services.mcpHub.readResource(server_name, uri)

		// Process the resource result
		const resourceResultPretty =
			resourceResult?.contents
				.map((item: any) => {
					if (item.text) {
						return item.text
					}
					return ""
				})
				.filter(Boolean)
				.join("\n\n") || "(Empty response)"

		// Display result to user
		await config.callbacks.say("mcp_server_response", resourceResultPretty)

		// Return formatted result
		return formatResponse.toolResult(resourceResultPretty)
	}
}
