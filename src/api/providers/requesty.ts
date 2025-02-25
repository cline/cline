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

export async function getRequestyModels({ apiKey }: { apiKey?: string }) {
	const models: Record<string, ModelInfo> = {}

	if (!apiKey) {
		return models
	}

	try {
		const config: Record<string, any> = {}
		config["headers"] = { Authorization: `Bearer ${apiKey}` }

		const response = await axios.get("https://router.requesty.ai/v1/models", config)
		const rawModels = response.data.data

		for (const rawModel of rawModels) {
			const modelInfo: ModelInfo = {
				maxTokens: rawModel.max_output_tokens,
				contextWindow: rawModel.context_window,
				supportsImages: rawModel.support_image,
				supportsComputerUse: rawModel.support_computer_use,
				supportsPromptCache: rawModel.supports_caching,
				inputPrice: parseApiPrice(rawModel.input_price),
				outputPrice: parseApiPrice(rawModel.output_price),
				description: rawModel.description,
				cacheWritesPrice: parseApiPrice(rawModel.caching_price),
				cacheReadsPrice: parseApiPrice(rawModel.cached_price),
			}

			switch (rawModel.id) {
				case rawModel.id.startsWith("anthropic/claude-3-7-sonnet"):
					modelInfo.maxTokens = 16384
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
