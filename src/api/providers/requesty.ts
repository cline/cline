import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { type ModelInfo, requestyDefaultModelId, requestyDefaultModelInfo } from "@roo-code/types"

import type { ApiHandlerOptions, ModelRecord } from "../../shared/api"
import { calculateApiCostOpenAI } from "../../shared/cost"

import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { getModelParams } from "../transform/model-params"
import { AnthropicReasoningParams } from "../transform/reasoning"

import { DEFAULT_HEADERS } from "./constants"
import { getModels } from "./fetchers/modelCache"
import { BaseProvider } from "./base-provider"
import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"

// Requesty usage includes an extra field for Anthropic use cases.
// Safely cast the prompt token details section to the appropriate structure.
interface RequestyUsage extends OpenAI.CompletionUsage {
	prompt_tokens_details?: {
		caching_tokens?: number
		cached_tokens?: number
	}
	total_cost?: number
}

type RequestyChatCompletionParams = OpenAI.Chat.ChatCompletionCreateParams & {
	requesty?: {
		trace_id?: string
		extra?: {
			mode?: string
		}
	}
	thinking?: AnthropicReasoningParams
}

export class RequestyHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	protected models: ModelRecord = {}
	private client: OpenAI

	constructor(options: ApiHandlerOptions) {
		super()

		this.options = options

		this.client = new OpenAI({
			baseURL: "https://router.requesty.ai/v1",
			apiKey: this.options.requestyApiKey ?? "not-provided",
			defaultHeaders: DEFAULT_HEADERS,
		})
	}

	public async fetchModel() {
		this.models = await getModels({ provider: "requesty" })
		return this.getModel()
	}

	override getModel() {
		const id = this.options.requestyModelId ?? requestyDefaultModelId
		const info = this.models[id] ?? requestyDefaultModelInfo

		const params = getModelParams({
			format: "anthropic",
			modelId: id,
			model: info,
			settings: this.options,
		})

		return { id, info, ...params }
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

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const {
			id: model,
			info,
			maxTokens: max_tokens,
			temperature,
			reasoningEffort: reasoning_effort,
			reasoning: thinking,
		} = await this.fetchModel()

		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		const completionParams: RequestyChatCompletionParams = {
			messages: openAiMessages,
			model,
			max_tokens,
			temperature,
			...(reasoning_effort && { reasoning_effort }),
			...(thinking && { thinking }),
			stream: true,
			stream_options: { include_usage: true },
			requesty: { trace_id: metadata?.taskId, extra: { mode: metadata?.mode } },
		}

		const stream = await this.client.chat.completions.create(completionParams)
		let lastUsage: any = undefined

		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta

			if (delta?.content) {
				yield { type: "text", text: delta.content }
			}

			if (delta && "reasoning_content" in delta && delta.reasoning_content) {
				yield { type: "reasoning", text: (delta.reasoning_content as string | undefined) || "" }
			}

			if (chunk.usage) {
				lastUsage = chunk.usage
			}
		}

		if (lastUsage) {
			yield this.processUsageMetrics(lastUsage, info)
		}
	}

	async completePrompt(prompt: string): Promise<string> {
		const { id: model, maxTokens: max_tokens, temperature } = await this.fetchModel()

		let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: "system", content: prompt }]

		const completionParams: RequestyChatCompletionParams = {
			model,
			max_tokens,
			messages: openAiMessages,
			temperature: temperature,
		}

		const response: OpenAI.Chat.ChatCompletion = await this.client.chat.completions.create(completionParams)
		return response.choices[0]?.message.content || ""
	}
}
