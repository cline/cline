import { telemetryService } from "@/services/posthog/telemetry/TelemetryService"
import { Controller } from ".."
import { Empty, StringRequest } from "../../../shared/proto/common"
import { getGlobalState, updateGlobalState } from "@/core/storage/state"

/**
 * Toggles a model's favorite status
 * @param controller The controller instance
 * @param request The request containing the model ID to toggle
 * @returns An empty response
 */
export async function toggleFavoriteModel(controller: Controller, request: StringRequest): Promise<Empty> {
	try {
		if (!request.value) {
			throw new Error("Model ID is required")
		}

		const modelId = request.value
		const currentFavorites = ((await getGlobalState(controller.context, "favoritedModelIds")) as string[]) || []

		// Toggle favorite status
		const updatedFavorites = currentFavorites.includes(modelId)
			? currentFavorites.filter((id) => id !== modelId)
			: [...currentFavorites, modelId]

		await updateGlobalState(controller.context, "favoritedModelIds", updatedFavorites)

		// Capture telemetry for model favorite toggle
		const isFavorited = !currentFavorites.includes(modelId)
		telemetryService.captureModelFavoritesUsage(modelId, isFavorited)

		// Post state to webview without changing any other configuration
		await controller.postStateToWebview()

		return Empty.create()
	} catch (error) {
		console.error(`Failed to toggle favorite status for model ${request.value}:`, error)
		throw error
	}
}
