import { Controller } from ".."
import { Empty } from "../../../shared/proto/common"
import { UpdateSettingsRequest } from "../../../shared/proto/state"
import { buildApiHandler } from "../../../api"
import { updateApiConfiguration, updateGlobalState } from "../../storage/state"
import {
	convertProtoApiConfigurationToDomainApiConfiguration,
	convertProtoTelemetrySettingToDomainTelemetrySetting,
	convertProtoChatSettingsToDomainChatSettings,
} from "../../../shared/proto-conversions/state/settings-conversion"

/**
 * Updates multiple extension settings in a single call
 * @param controller The controller instance
 * @param request The settings update request
 * @returns Empty response
 */
export async function updateSettings(controller: Controller, request: UpdateSettingsRequest): Promise<Empty> {
	// API configuration
	if (request.apiConfiguration) {
		const domainConfig = convertProtoApiConfigurationToDomainApiConfiguration(request.apiConfiguration)
		await updateApiConfiguration(controller.context, domainConfig)
		if (controller.task) {
			controller.task.api = buildApiHandler(domainConfig)
		}
	} else {
		console.log("[DEBUG] No API configuration in request")
	}

	// Custom instructions
	await controller.updateCustomInstructions(request.customInstructionsSetting)

	// Telemetry setting
	if (request.telemetrySetting !== undefined) {
		const domainTelemetrySetting = convertProtoTelemetrySettingToDomainTelemetrySetting(request.telemetrySetting)
		await controller.updateTelemetrySetting(domainTelemetrySetting)
	}

	// Plan/Act separate models setting
	await updateGlobalState(controller.context, "planActSeparateModelsSetting", request.planActSeparateModelsSetting)

	// Enable checkpoints setting
	if (typeof request.enableCheckpointsSetting === "boolean") {
		await updateGlobalState(controller.context, "enableCheckpointsSetting", request.enableCheckpointsSetting)
	}

	// MCP marketplace enabled
	if (typeof request.mcpMarketplaceEnabled === "boolean") {
		await updateGlobalState(controller.context, "mcpMarketplaceEnabled", request.mcpMarketplaceEnabled)
	}

	// Chat settings
	if (request.chatSettings) {
		const domainChatSettings = convertProtoChatSettingsToDomainChatSettings(request.chatSettings)
		await updateGlobalState(controller.context, "chatSettings", domainChatSettings)
		if (controller.task) {
			controller.task.chatSettings = domainChatSettings
		}
	}

	// Favorited model IDs   --- TODO review this
	//if (request.favoritedModelIds && request.favoritedModelIds.length > 0) {
	//	await updateGlobalState(controller.context, "favoritedModelIds", request.favoritedModelIds)
	//	console.log("[DEBUG] Saving favoritedModelIds:", request.favoritedModelIds)
	//}
	//
	//// Request timeout - Used by Ollama provider  --- TODO review this
	if (typeof request.requestTimeoutMs === "number") {
		console.log("[DEBUG] Saving requestTimeoutMs:", request.requestTimeoutMs)
		await updateGlobalState(controller.context, "requestTimeoutMs", request.requestTimeoutMs)
		console.log("[DEBUG] Updated requestTimeoutMs in global state")
	} else {
		console.log("[DEBUG] No requestTimeoutMs in request or not a number type")
	}

	// After settings are updated, post state to webview
	await controller.postStateToWebview()

	return Empty.create()
}
