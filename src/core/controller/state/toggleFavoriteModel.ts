import { telemetryService } from "@services/posthog/PostHogClientProvider"
import { Controller } from ".."
import { Empty, StringRequest } from "@shared/proto/cline/common"

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
		const apiConfiguration = controller.cacheService.getApiConfiguration()

		const favoritedModelIds = apiConfiguration.favoritedModelIds || []

		// Toggle favorite status
		const updatedFavorites = favoritedModelIds.includes(modelId)
			? favoritedModelIds.filter((id) => id !== modelId)
			: [...favoritedModelIds, modelId]

		// Update the complete API configuration through cache service
		const updatedApiConfiguration = {
			...apiConfiguration,
			favoritedModelIds: updatedFavorites,
		}
		controller.cacheService.setApiConfiguration(updatedApiConfiguration)

		// Capture telemetry for model favorite toggle
		const isFavorited = !favoritedModelIds.includes(modelId)
		telemetryService.captureModelFavoritesUsage(modelId, isFavorited)

		// Post state to webview without changing any other configuration
		await controller.postStateToWebview()

		return Empty.create()
	} catch (error) {
		console.error(`Failed to toggle favorite status for model ${request.value}:`, error)
		throw error
	}
}
