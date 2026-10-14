import type { ModelInfo } from "@shared/api"
import { OpenRouterCompatibleModelInfo } from "@shared/proto/cline/models"
import { toProtobufModels } from "@/shared/proto-conversions/models/typeConversion"
import { Logger } from "@/shared/services/Logger"
import { type ProviderCatalogController, resolveProviderModelsRecord } from "./providerCatalogShared"
import { sendLiteLlmModelsEvent } from "./subscribeToLiteLlmModels"

/**
 * Core function: Refreshes the LiteLLM models and returns application types
 * @param controller The controller instance
 * @returns Record of model ID to ModelInfo (application types)
 */
export async function refreshLiteLlmModels(controller: ProviderCatalogController): Promise<Record<string, ModelInfo>> {
	try {
		const models: Record<string, ModelInfo> = await resolveProviderModelsRecord(controller, "litellm", {
			forceRefresh: true,
		})

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
