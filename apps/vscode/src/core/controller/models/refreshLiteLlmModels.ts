import type { ModelInfo } from "@shared/api"
import { OpenRouterCompatibleModelInfo } from "@shared/proto/cline/models"
import { StateManager } from "@/core/storage/StateManager"
import { parseProviderId } from "@/sdk/model-catalog/provider-id"
import { toProtobufModels } from "@/shared/proto-conversions/models/typeConversion"
import { Logger } from "@/shared/services/Logger"
import type { ProviderCatalogController } from "./providerCatalogShared"
import { sendLiteLlmModelsEvent } from "./subscribeToLiteLlmModels"

/**
 * Core function: Refreshes the LiteLLM models and returns application types
 * @param controller The controller instance
 * @returns Record of model ID to ModelInfo (application types)
 */
export async function refreshLiteLlmModels(controller: ProviderCatalogController): Promise<Record<string, ModelInfo>> {
	try {
		const result = await controller.getProviderCatalog().resolveModels(parseProviderId("litellm"), { forceRefresh: true })
		if (!result.ok) {
			throw new Error(result.error.message)
		}

		const models: Record<string, ModelInfo> = Object.fromEntries(result.models)

		// Store in StateManager's in-memory cache
		StateManager.get().setModelsCache("liteLlm", models)

		// Send event to subscribers
		try {
			await sendLiteLlmModelsEvent(
				OpenRouterCompatibleModelInfo.create({
					models: toProtobufModels(models),
				}),
			)
		} catch (error) {
			Logger.error("Error sending LiteLLM models event:", error)
		}

		return models
	} catch (error) {
		Logger.error("Error fetching LiteLLM models:", error)
		throw error
	}
}
