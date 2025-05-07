import axios from "axios"
import { COMPUTER_USE_MODELS, ModelRecord } from "../../../shared/api"

/**
 * Fetches available models from a LiteLLM server
 *
 * @param apiKey The API key for the LiteLLM server
 * @param baseUrl The base URL of the LiteLLM server
 * @returns A promise that resolves to a record of model IDs to model info
 */
export async function getLiteLLMModels(apiKey: string, baseUrl: string): Promise<ModelRecord> {
	try {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		}

		if (apiKey) {
			headers["Authorization"] = `Bearer ${apiKey}`
		}

		const response = await axios.get(`${baseUrl}/v1/model/info`, { headers })
		const models: ModelRecord = {}

		const computerModels = Array.from(COMPUTER_USE_MODELS)

		// Process the model info from the response
		if (response.data && response.data.data && Array.isArray(response.data.data)) {
			for (const model of response.data.data) {
				const modelName = model.model_name
				const modelInfo = model.model_info
				const litellmModelName = model?.litellm_params?.model as string | undefined

				if (!modelName || !modelInfo || !litellmModelName) continue

				models[modelName] = {
					maxTokens: modelInfo.max_tokens || 8192,
					contextWindow: modelInfo.max_input_tokens || 200000,
					supportsImages: Boolean(modelInfo.supports_vision),
					// litellm_params.model may have a prefix like openrouter/
					supportsComputerUse: computerModels.some((computer_model) =>
						litellmModelName.endsWith(computer_model),
					),
					supportsPromptCache: Boolean(modelInfo.supports_prompt_caching),
					inputPrice: modelInfo.input_cost_per_token ? modelInfo.input_cost_per_token * 1000000 : undefined,
					outputPrice: modelInfo.output_cost_per_token
						? modelInfo.output_cost_per_token * 1000000
						: undefined,
					description: `${modelName} via LiteLLM proxy`,
				}
			}
		}

		return models
	} catch (error) {
		console.error("Error fetching LiteLLM models:", error)
		return {}
	}
}
