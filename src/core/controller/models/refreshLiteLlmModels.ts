import type { ModelInfo } from "@shared/api"
import { OpenRouterCompatibleModelInfo } from "@shared/proto/cline/models"
import { fetchLiteLlmModelsInfo } from "@/core/api/providers/litellm"
import { StateManager } from "@/core/storage/StateManager"
import { toProtobufModels } from "@/shared/proto-conversions/models/typeConversion"
import { sendLiteLlmModelsEvent } from "./subscribeToLiteLlmModels"

/**
 * Checks if a LiteLLM model ID matches known reasoning-capable model patterns.
 * This handles cases where the LiteLLM API doesn't correctly report supports_reasoning.
 */
function isKnownReasoningModel(modelId: string): boolean {
	// Match Claude Sonnet 4.x, Opus 4.x, Haiku 4.5 models (including Bedrock variants)
	// Patterns: anthropic.claude-*, us.anthropic.claude-*, eu.anthropic.claude-*
	const reasoningModelPatterns = [
		/claude-(sonnet|opus|haiku)-4(\.|-)/, // Claude 4.x models
		/claude-sonnet-4-5-20250929/, // Specific Sonnet 4.5
		/claude-opus-4-5-20251101/, // Specific Opus 4.5
		/claude-haiku-4-5-20251001/, // Specific Haiku 4.5
		/o3-mini/, // OpenAI o3-mini
		/deepseek.*r1/i, // DeepSeek R1
	]

	return reasoningModelPatterns.some((pattern) => pattern.test(modelId))
}

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
				const modelId = rawModel.model_name
				const apiSupportsReasoning = rawModel.model_info?.supports_reasoning ?? false

				const modelInfo: ModelInfo = {
					name: modelId,
					maxTokens: rawModel.model_info?.max_output_tokens ?? rawModel.model_info?.max_tokens ?? 4096,
					contextWindow: rawModel.model_info?.max_input_tokens ?? rawModel.model_info?.max_tokens ?? 8192,
					supportsImages: rawModel.model_info?.supports_vision ?? false,
					supportsPromptCache: rawModel.model_info?.supports_prompt_caching ?? false,
					// Use API response, but fall back to known model patterns
					supportsReasoning: apiSupportsReasoning || isKnownReasoningModel(modelId),
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

				models[modelId] = modelInfo
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
