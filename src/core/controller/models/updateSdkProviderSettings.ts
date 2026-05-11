import { Empty } from "@shared/proto/cline/common"
import { UpdateSdkProviderSettingsRequest } from "@shared/proto/cline/models"
import { saveSdkProviderSettings } from "@/sdk/sdk-provider-settings-service"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"

function isMode(value: string | undefined): value is "plan" | "act" {
	return value === "plan" || value === "act"
}

/**
 * Saves generic SDK provider settings and mirrors the selected provider/model
 * into legacy global state so the existing webview state shape remains usable
 * while the settings UI migrates to SDK-backed providers.
 */
export async function updateSdkProviderSettings(
	controller: Controller,
	request: UpdateSdkProviderSettingsRequest,
): Promise<Empty> {
	try {
		const providerId = request.providerId.trim()
		if (!providerId) {
			throw new Error("provider_id is required")
		}
		if (!isMode(request.mode)) {
			throw new Error(`Invalid mode: ${request.mode}`)
		}

		saveSdkProviderSettings(controller.stateManager, {
			providerId,
			mode: request.mode,
			modelId: request.modelId,
			apiKey: request.apiKey,
			baseUrl: request.baseUrl,
			enabled: request.enabled,
		})

		if (controller.task) {
			const currentMode = controller.stateManager.getGlobalSettingsKey("mode")
			const { buildApiHandler } = await import("@/core/api")
			controller.task.api = buildApiHandler(
				{
					...controller.stateManager.getApiConfiguration(),
					ulid: controller.task.ulid,
				},
				currentMode,
			)
		}

		await controller.postStateToWebview()
		return Empty.create()
	} catch (error) {
		Logger.error(`[updateSdkProviderSettings] Failed to update SDK provider settings: ${error}`)
		throw error
	}
}
