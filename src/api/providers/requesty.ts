import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { ModelInfo, ModelRecord, requestyDefaultModelId, requestyDefaultModelInfo } from "../../shared/api"
import { calculateApiCostOpenAI } from "../../utils/cost"
import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { OpenAiHandler, OpenAiHandlerOptions } from "./openai"
import { getModels } from "./fetchers/cache"

// Requesty usage includes an extra field for Anthropic use cases.
// Safely cast the prompt token details section to the appropriate structure.
interface RequestyUsage extends OpenAI.CompletionUsage {
	prompt_tokens_details?: {
		caching_tokens?: number
		cached_tokens?: number
	}
	total_cost?: number
}

export class RequestyHandler extends OpenAiHandler {
	protected models: ModelRecord = {}

	constructor(options: OpenAiHandlerOptions) {
		if (!options.requestyApiKey) {
			throw new Error("Requesty API key is required. Please provide it in the settings.")
		}

		super({
			...options,
			openAiApiKey: options.requestyApiKey,
			openAiModelId: options.requestyModelId ?? requestyDefaultModelId,
			openAiBaseUrl: "https://router.requesty.ai/v1",
		})
	}

	override async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		this.models = await getModels("requesty")
		yield* super.createMessage(systemPrompt, messages)
	}

	override getModel(): { id: string; info: ModelInfo } {
		const id = this.options.requestyModelId ?? requestyDefaultModelId
		const info = this.models[id] ?? requestyDefaultModelInfo
		return { id, info }
	}

	protected override processUsageMetrics(usage: any, modelInfo?: ModelInfo): ApiStreamUsageChunk {
		const requestyUsage = usage as RequestyUsage
		const inputTokens = requestyUsage?.prompt_tokens || 0
		const outputTokens = requestyUsage?.completion_tokens || 0
		const cacheWriteTokens = requestyUsage?.prompt_tokens_details?.caching_tokens || 0
		const cacheReadTokens = requestyUsage?.prompt_tokens_details?.cached_tokens || 0
		const totalCost = modelInfo
			? calculateApiCostOpenAI(modelInfo, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens)
			: 0

		return {
			type: "usage",
			inputTokens: inputTokens,
			outputTokens: outputTokens,
			cacheWriteTokens: cacheWriteTokens,
			cacheReadTokens: cacheReadTokens,
			totalCost: totalCost,
		}
	}

	override async completePrompt(prompt: string): Promise<string> {
		this.models = await getModels("requesty")
		return super.completePrompt(prompt)
	}
}
