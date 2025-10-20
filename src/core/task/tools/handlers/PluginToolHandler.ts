/**
 * Plugin Tool Handler
 *
 * Handles execution of plugin capabilities through the tool coordinator.
 * Integrates plugin system with Cline's tool execution infrastructure.
 */

import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { ClineAsk } from "@shared/ExtensionMessage"
import type { PluginContextConfig } from "@/services/plugins/PluginContext"
import { telemetryService } from "@/services/telemetry"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import { showNotificationForApprovalIfAutoApprovalEnabled } from "../../utils"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { ToolResultUtils } from "../utils/ToolResultUtils"

/**
 * Message type for plugin execution (similar to ClineAskUseMcpServer)
 */
interface ClineAskUsePlugin {
	type: "use_plugin"
	pluginId: string
	capabilityName: string
	parameters: string // JSON string
}

export class PluginToolHandler implements IFullyManagedTool {
	readonly name = ClineDefaultTool.PLUGIN_EXECUTE

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.plugin_id}.${block.params.capability_name}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const plugin_id = block.params.plugin_id
		const capability_name = block.params.capability_name
		const parameters = block.params.parameters

		const partialMessage = JSON.stringify({
			type: "use_plugin",
			pluginId: uiHelpers.removeClosingTag(block, "plugin_id", plugin_id),
			capabilityName: uiHelpers.removeClosingTag(block, "capability_name", capability_name),
			parameters: uiHelpers.removeClosingTag(block, "parameters", parameters),
		} satisfies ClineAskUsePlugin)

		// Check if tool should be auto-approved
		const config = uiHelpers.getConfig()
		const shouldAutoApprove = config.callbacks.shouldAutoApproveTool(block.name)

		if (shouldAutoApprove) {
			await uiHelpers.removeLastPartialMessageIfExistsWithType("ask", "use_plugin")
			await uiHelpers.say("use_plugin" as any, partialMessage, undefined, undefined, block.partial)
		} else {
			await uiHelpers.removeLastPartialMessageIfExistsWithType("say", "use_plugin")
			await uiHelpers.ask("use_plugin" as ClineAsk, partialMessage, block.partial).catch(() => {})
		}
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const plugin_id: string | undefined = block.params.plugin_id
		const capability_name: string | undefined = block.params.capability_name
		const parameters: string | undefined = block.params.parameters

		// Validate required parameters
		if (!plugin_id) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "plugin_id")
		}

		if (!capability_name) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "capability_name")
		}

		// Parse and validate parameters if provided
		let parsedParameters: Record<string, any> = {}
		if (parameters) {
			try {
				parsedParameters = JSON.parse(parameters)
			} catch (_error) {
				config.taskState.consecutiveMistakeCount++
				await config.callbacks.say(
					"error",
					`Cline tried to use ${capability_name} with an invalid JSON parameter. Retrying...`,
				)
				return formatResponse.toolError(formatResponse.invalidPluginArgumentError(plugin_id, capability_name || ""))
			}
		}

		config.taskState.consecutiveMistakeCount = 0

		// Handle approval flow
		const completeMessage = JSON.stringify({
			type: "use_plugin",
			pluginId: plugin_id,
			capabilityName: capability_name,
			parameters: parameters ?? "{}",
		} satisfies ClineAskUsePlugin)

		// Check if this specific plugin capability is auto-approved
		// For now, plugins follow the general tool auto-approval setting
		// In the future, we could add per-plugin capability auto-approval
		if (config.callbacks.shouldAutoApproveTool(block.name)) {
			// Auto-approval flow
			await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "use_plugin")
			await config.callbacks.say("use_plugin", completeMessage, undefined, undefined, false)
			if (!config.yoloModeToggled) {
				config.taskState.consecutiveAutoApprovedRequestsCount++
			}

			// Capture telemetry
			telemetryService.captureToolUsage(config.ulid, block.name, config.api.getModel().id, true, true)
		} else {
			// Manual approval flow
			const notificationMessage = `Cline wants to use ${capability_name || "unknown capability"} from ${plugin_id || "unknown plugin"}`

			// Show notification
			showNotificationForApprovalIfAutoApprovalEnabled(
				notificationMessage,
				config.autoApprovalSettings.enabled,
				config.autoApprovalSettings.enableNotifications,
			)

			await config.callbacks.removeLastPartialMessageIfExistsWithType("say", "use_plugin")

			const didApprove = await ToolResultUtils.askApprovalAndPushFeedback("use_plugin", completeMessage, config)
			if (!didApprove) {
				telemetryService.captureToolUsage(config.ulid, block.name, config.api.getModel().id, false, false)
				return formatResponse.toolDenied()
			} else {
				telemetryService.captureToolUsage(config.ulid, block.name, config.api.getModel().id, false, true)
			}
		}

		// Show plugin request started message
		await config.callbacks.say("plugin_request_started", `Executing ${plugin_id}.${capability_name}...`)

		try {
			// Check if plugin hub is available
			if (!config.services.pluginHub) {
				throw new Error("Plugin system is not initialized")
			}

			// Create plugin context configuration
			const contextConfig: PluginContextConfig = {
				pluginId: plugin_id,
				taskId: config.ulid,
				taskMode: config.mode,
				workingDirectory: config.cwd,
				extensionContext: config.context,
				notifyCallback: (message: string) => {
					config.callbacks.say("plugin_notification", `[${plugin_id}] ${message}`)
				},
				requestInputCallback: async (prompt: string) => {
					const response = await config.callbacks.ask("followup", prompt)
					return response.text || ""
				},
			}

			// Execute the plugin capability
			const result = await config.services.pluginHub.executePluginCapability(
				plugin_id,
				capability_name,
				parsedParameters,
				contextConfig,
			)

			// Check if execution was successful
			if (!result.success) {
				await config.callbacks.say("plugin_error", `Error: ${result.error}`)
				return formatResponse.pluginError(plugin_id, capability_name, result.error || "Unknown error")
			}

			// Format the result for display
			const resultText = typeof result.data === "string" ? result.data : JSON.stringify(result.data, null, 2)

			await config.callbacks.say("plugin_response", resultText)

			// Return formatted result
			return formatResponse.pluginSuccess(plugin_id, capability_name, resultText)
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			await config.callbacks.say("plugin_error", `Error: ${errorMessage}`)
			return formatResponse.pluginError(plugin_id, capability_name, errorMessage)
		}
	}
}
