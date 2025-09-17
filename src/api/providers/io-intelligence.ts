import { ioIntelligenceDefaultModelId, ioIntelligenceModels, type IOIntelligenceModelId } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"
import { BaseOpenAiCompatibleProvider } from "./base-openai-compatible-provider"

export class IOIntelligenceHandler extends BaseOpenAiCompatibleProvider<IOIntelligenceModelId> {
	constructor(options: ApiHandlerOptions) {
		if (!options.ioIntelligenceApiKey) {
			throw new Error("IO Intelligence API key is required")
		}

		super({
			...options,
			providerName: "IO Intelligence",
			baseURL: "https://api.intelligence.io.solutions/api/v1",
			defaultProviderModelId: ioIntelligenceDefaultModelId,
			providerModels: ioIntelligenceModels,
			defaultTemperature: 0.7,
			apiKey: options.ioIntelligenceApiKey,
		})
	}

	override getModel() {
		const modelId = this.options.ioIntelligenceModelId || (ioIntelligenceDefaultModelId as IOIntelligenceModelId)

		const modelInfo =
			this.providerModels[modelId as IOIntelligenceModelId] ?? this.providerModels[ioIntelligenceDefaultModelId]

		if (modelInfo) {
			return { id: modelId as IOIntelligenceModelId, info: modelInfo }
		}

		// Return the requested model ID even if not found, with fallback info.
		return {
			id: modelId as IOIntelligenceModelId,
			info: {
				maxTokens: 8192,
				contextWindow: 128000,
				supportsImages: false,
				supportsPromptCache: false,
			},
		}
	}
}
