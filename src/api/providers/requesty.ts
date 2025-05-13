import { Anthropic } from "@anthropic-ai/sdk"
import {
	ApiHandlerOptions,
	ModelInfo,
	ModelRecord,
	requestyDefaultModelId,
	requestyDefaultModelInfo,
} from "../../shared/api"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { calculateApiCostOpenAI } from "../../utils/cost"
import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { SingleCompletionHandler } from "../"
import { BaseProvider } from "./base-provider"
import { DEFAULT_HEADERS } from "./constants"
import { getModels } from "./fetchers/modelCache"
import OpenAI from "openai"

// Requesty usage includes an extra field for Anthropic use cases.
// Safely cast the prompt token details section to the appropriate structure.
interface RequestyUsage extends OpenAI.CompletionUsage {
	prompt_tokens_details?: {
		caching_tokens?: number
		cached_tokens?: number
	}
	total_cost?: number
}

type RequestyChatCompletionParams = OpenAI.Chat.ChatCompletionCreateParams & {}

export class RequestyHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	protected models: ModelRecord = {}
	private client: OpenAI

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options

		const apiKey = this.options.requestyApiKey ?? "not-provided"
		const baseURL = "https://router.requesty.ai/v1"

		const defaultHeaders = DEFAULT_HEADERS

		this.client = new OpenAI({ baseURL, apiKey, defaultHeaders })
	}

	public async fetchModel() {
		this.models = await getModels("requesty")
		return this.getModel()
	}

	override getModel(): { id: string; info: ModelInfo } {
		const id = this.options.requestyModelId ?? requestyDefaultModelId
		const info = this.models[id] ?? requestyDefaultModelInfo
		return { id, info }
	}

	protected processUsageMetrics(usage: any, modelInfo?: ModelInfo): ApiStreamUsageChunk {
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

	override async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const model = await this.fetchModel()

		let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		let maxTokens = undefined
		if (this.options.includeMaxTokens) {
			maxTokens = model.info.maxTokens
		}

		const temperature = this.options.modelTemperature

		const completionParams: RequestyChatCompletionParams = {
			model: model.id,
			max_tokens: maxTokens,
			messages: openAiMessages,
			temperature: temperature,
			stream: true,
			stream_options: { include_usage: true },
		}

		const stream = await this.client.chat.completions.create(completionParams)

		let lastUsage: any = undefined

		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			if (delta && "reasoning_content" in delta && delta.reasoning_content) {
				yield {
					type: "reasoning",
					text: (delta.reasoning_content as string | undefined) || "",
				}
			}

			if (chunk.usage) {
				lastUsage = chunk.usage
			}
		}

		if (lastUsage) {
			yield this.processUsageMetrics(lastUsage, model.info)
		}
	}

	async completePrompt(prompt: string): Promise<string> {
		const model = await this.fetchModel()

		let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: "system", content: prompt }]

		let maxTokens = undefined
		if (this.options.includeMaxTokens) {
			maxTokens = model.info.maxTokens
		}

		const temperature = this.options.modelTemperature

		const completionParams: RequestyChatCompletionParams = {
			model: model.id,
			max_tokens: maxTokens,
			messages: openAiMessages,
			temperature: temperature,
		}

		const response: OpenAI.Chat.ChatCompletion = await this.client.chat.completions.create(completionParams)
		return response.choices[0]?.message.content || ""
	}
}
