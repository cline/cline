import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { ApiHandler } from "../"
import { ApiHandlerOptions, ModelInfo, openRouterDefaultModelId, openRouterDefaultModelInfo } from "../../shared/api"
import { streamOpenRouterFormatRequest } from "../transform/openrouter-stream"
import { ApiStream } from "../transform/stream"
import axios from "axios"

export class ClineHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: OpenAI

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new OpenAI({
			baseURL: "https://api.cline.bot/v1",
			apiKey: this.options.clineApiKey || "",
		})
	}

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
