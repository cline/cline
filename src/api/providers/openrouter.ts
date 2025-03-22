import { Anthropic } from "@anthropic-ai/sdk"
import axios from "axios"
import delay from "delay"
import OpenAI from "openai"
import { withRetry } from "../retry"
import { ApiHandler } from "../"
import { ApiHandlerOptions, ModelInfo, openRouterDefaultModelId, openRouterDefaultModelInfo } from "../../shared/api"
import { streamOpenRouterFormatRequest } from "../transform/openrouter-stream"
import { ApiStream } from "../transform/stream"
import { convertToR1Format } from "../transform/r1-format"
import { OpenRouterErrorResponse } from "./types"

export class OpenRouterHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: OpenAI

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new OpenAI({
			baseURL: "https://openrouter.ai/api/v1",
			apiKey: this.options.openRouterApiKey,
			defaultHeaders: {
				"HTTP-Referer": "https://cline.bot", // Optional, for including your app on openrouter.ai rankings.
				"X-Title": "Cline", // Optional. Shows in rankings on openrouter.ai.
			},
		})
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const model = this.getModel()
		yield* streamOpenRouterFormatRequest(
			this.client,
			systemPrompt,
			messages,
			model,
			this.options.o3MiniReasoningEffort,
			this.options.thinkingBudgetTokens,
			this.options.openRouterProviderSorting,
		)
	}

	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.openRouterModelId
		const modelInfo = this.options.openRouterModelInfo
		if (modelId && modelInfo) {
			return { id: modelId, info: modelInfo }
		}
		return { id: openRouterDefaultModelId, info: openRouterDefaultModelInfo }
	}
}
