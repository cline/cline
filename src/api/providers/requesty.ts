import axios from "axios"

import { ModelInfo, requestyModelInfoSaneDefaults, requestyDefaultModelId } from "../../shared/api"
import { parseApiPrice } from "../../utils/cost"
import { ApiStreamUsageChunk } from "../transform/stream"
import { OpenAiHandler, OpenAiHandlerOptions } from "./openai"

export class RequestyHandler extends OpenAiHandler {
	constructor(options: OpenAiHandlerOptions) {
		if (!options.requestyApiKey) {
			throw new Error("Requesty API key is required. Please provide it in the settings.")
		}
		super({
			...options,
			openAiApiKey: options.requestyApiKey,
			openAiModelId: options.requestyModelId ?? requestyDefaultModelId,
			openAiBaseUrl: "https://router.requesty.ai/v1",
			openAiCustomModelInfo: options.requestyModelInfo ?? requestyModelInfoSaneDefaults,
			defaultHeaders: {
				"HTTP-Referer": "https://github.com/RooVetGit/Roo-Cline",
				"X-Title": "Roo Code",
			},
		})
	}

	override getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.requestyModelId ?? requestyDefaultModelId
		return {
			id: modelId,
			info: this.options.requestyModelInfo ?? requestyModelInfoSaneDefaults,
		}
	}

	protected override processUsageMetrics(usage: any): ApiStreamUsageChunk {
		return {
			type: "usage",
			inputTokens: usage?.prompt_tokens || 0,
			outputTokens: usage?.completion_tokens || 0,
			cacheWriteTokens: usage?.cache_creation_input_tokens,
			cacheReadTokens: usage?.cache_read_input_tokens,
		}
	}
}

export async function getRequestyModels() {
	const models: Record<string, ModelInfo> = {}

	try {
		const response = await axios.get("https://router.requesty.ai/v1/models")
		const rawModels = response.data.data

		for (const rawModel of rawModels) {
			// {
			// 	id: "anthropic/claude-3-5-sonnet-20240620",
			// 	object: "model",
			// 	created: 1740552655,
			// 	owned_by: "system",
			// 	input_price: 0.0000028,
			// 	caching_price: 0.00000375,
			// 	cached_price: 3e-7,
			// 	output_price: 0.000015,
			// 	max_output_tokens: 8192,
			// 	context_window: 200000,
			// 	supports_caching: true,
			// 	description:
			// 		"Anthropic's previous most intelligent model. High level of intelligence and capability. Excells in coding.",
			// }

			const modelInfo: ModelInfo = {
				maxTokens: rawModel.max_output_tokens,
				contextWindow: rawModel.context_window,
				supportsPromptCache: rawModel.supports_caching,
				inputPrice: parseApiPrice(rawModel.input_price),
				outputPrice: parseApiPrice(rawModel.output_price),
				description: rawModel.description,
				cacheWritesPrice: parseApiPrice(rawModel.caching_price),
				cacheReadsPrice: parseApiPrice(rawModel.cached_price),
			}

			switch (rawModel.id) {
				case rawModel.id.startsWith("anthropic/claude-3-7-sonnet"):
					modelInfo.supportsComputerUse = true
					modelInfo.supportsImages = true
					modelInfo.maxTokens = 16384
					break
				case rawModel.id.startsWith("anthropic/claude-3-5-sonnet-20241022"):
					modelInfo.supportsComputerUse = true
					modelInfo.supportsImages = true
					modelInfo.maxTokens = 8192
					break
				case rawModel.id.startsWith("anthropic/"):
					modelInfo.maxTokens = 8192
					break
				default:
					break
			}

			models[rawModel.id] = modelInfo
		}
	} catch (error) {
		console.error(`Error fetching Requesty models: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`)
	}

	return models
}
