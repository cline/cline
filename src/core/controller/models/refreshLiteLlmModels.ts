import type { ModelInfo } from "@shared/api"
import { OpenRouterCompatibleModelInfo } from "@shared/proto/cline/models"
import { fetchLiteLlmModelsInfo } from "@/core/api/providers/litellm"
import { StateManager } from "@/core/storage/StateManager"
import { toProtobufModels } from "@/shared/proto-conversions/models/typeConversion"
import { sendLiteLlmModelsEvent } from "./subscribeToLiteLlmModels"

/**
 * Core function: Refreshes the LiteLLM models and returns application types
 * @param controller The controller instance
 * @returns Record of model ID to ModelInfo (application types)
 */
export async function refreshLiteLlmModels(): Promise<Record<string, ModelInfo>> {
	const models: Record<string, ModelInfo> = {}

	const stateManager = StateManager.get()

	try {
		// Get the LiteLLM configuration
		const apiConfiguration = stateManager.getApiConfiguration()
		const baseUrl = apiConfiguration.liteLlmBaseUrl || ""
		const apiKey = apiConfiguration.liteLlmApiKey

		if (!apiKey) {
			throw new Error("LiteLLM API key is not configured or is invalid")
		}

		// Use the shared utility function to fetch model info
		const data = await fetchLiteLlmModelsInfo(baseUrl, apiKey)

		if (data?.data) {
			for (const rawModel of data.data) {
				const modelInfo: ModelInfo = {
					name: rawModel.model_name,
					maxTokens: rawModel.model_info?.max_output_tokens ?? rawModel.model_info?.max_tokens ?? 4096,
					contextWindow: rawModel.model_info?.max_input_tokens ?? rawModel.model_info?.max_tokens ?? 8192,
					supportsImages: rawModel.model_info?.supports_vision ?? false,
					supportsPromptCache: rawModel.model_info?.supports_prompt_caching ?? false,
					supportsReasoning: rawModel.model_info?.supports_reasoning ?? false,
					inputPrice: rawModel.model_info?.input_cost_per_token
						? rawModel.model_info.input_cost_per_token * 1_000_000
						: 0,
					outputPrice: rawModel.model_info?.output_cost_per_token
						? rawModel.model_info.output_cost_per_token * 1_000_000
						: 0,
					cacheWritesPrice: rawModel.model_info?.cache_creation_input_token_cost
						? rawModel.model_info.cache_creation_input_token_cost * 1_000_000
						: undefined,
					cacheReadsPrice: rawModel.model_info?.cache_read_input_token_cost
						? rawModel.model_info.cache_read_input_token_cost * 1_000_000
						: undefined,
					description: undefined,
				}

				models[rawModel.model_name] = modelInfo
			}
		}
	} catch (error) {
		console.error("Error fetching LiteLLM models:", error)
		throw error
	}

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
		console.error("Error sending LiteLLM models event:", error)
	}

	return models
}
