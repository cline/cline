import { Empty } from "@shared/proto/cline/common"
import { UpdateSdkProviderSelectionRequest } from "@shared/proto/cline/models"
import { setSelectedSdkProvider } from "@/sdk/sdk-provider-settings-service"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"

function isMode(value: string | undefined): value is "plan" | "act" {
	return value === "plan" || value === "act"
}

/**
 * Updates the active provider using an arbitrary SDK provider ID.
 *
 * This intentionally bypasses the legacy ApiProvider protobuf enum conversion
 * so the settings UI can select providers sourced from @clinebot/llms.
 */
export async function updateSdkProviderSelection(
	controller: Controller,
	request: UpdateSdkProviderSelectionRequest,
): Promise<Empty> {
	try {
		const providerId = request.providerId.trim()
		if (!providerId) {
			throw new Error("provider_id is required")
		}
		if (!isMode(request.mode)) {
			throw new Error(`Invalid mode: ${request.mode}`)
		}

		setSelectedSdkProvider(controller.stateManager, {
			providerId,
			mode: request.mode,
			modelId: request.modelId,
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
		Logger.error(`[updateSdkProviderSelection] Failed to update SDK provider selection: ${error}`)
		throw error
	}
}
