import { Anthropic } from "@anthropic-ai/sdk"
import { cortecsDefaultModelId, cortecsDefaultModelInfo, ModelInfo } from "@shared/api"
import { calculateApiCostOpenAI } from "@utils/cost"
import OpenAI from "openai"
import { ChatCompletionReasoningEffort } from "openai/resources/chat/completions"
import { ApiHandler, CommonApiHandlerOptions } from "../index"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

interface CortecsHandlerOptions extends CommonApiHandlerOptions {
	cortecsBaseUrl?: string
	cortecsApiKey?: string
	reasoningEffort?: string
	cortecsModelId?: string
	cortecsModelInfo?: ModelInfo
}

export class CortecsHandler implements ApiHandler {
	private options: CortecsHandlerOptions
	private client: OpenAI | undefined

	constructor(options: CortecsHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.cortecsApiKey) {
				throw new Error("Cortecs API key is required")
			}
			try {
				this.client = new OpenAI({
					baseURL: this.options.cortecsBaseUrl ?? "https://api.cortecs.ai/v1",
					apiKey: this.options.cortecsApiKey,
					defaultHeaders: {
						"HTTP-Referer": "https://cline.bot",
						"X-Title": "Cline",
					},
				})
			} catch (error: any) {
				throw new Error(`Error creating Cortecs client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const client = this.ensureClient()
		const model = this.getModel()
		let temperature: number | undefined = 0
		let reasoningEffort: ChatCompletionReasoningEffort | undefined
		let maxTokens: number | undefined

		let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		if (this.options.cortecsModelInfo?.maxTokens && this.options.cortecsModelInfo.maxTokens > 0) {
			maxTokens = Number(this.options.cortecsModelInfo.maxTokens)
		} else {
			maxTokens = undefined
		}

		const isReasoningModelFamily = model.id.includes("o1") || model.id.includes("o3") || model.id.includes("o4")

		if (isReasoningModelFamily) {
			openAiMessages = [{ role: "developer", content: systemPrompt }, ...convertToOpenAiMessages(messages)]
			temperature = undefined
			reasoningEffort = (this.options.reasoningEffort as ChatCompletionReasoningEffort) || "medium"
		}

		const stream = await client.chat.completions.create({
			model: model.id,
			max_tokens: maxTokens,
			messages: openAiMessages,
			temperature: temperature,
			stream: true,
			stream_options: { include_usage: true },
			reasoning_effort: reasoningEffort,
		})

		let lastUsage: any

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
					reasoning: (delta.reasoning_content as string | undefined) || "",
				}
			}

			if (chunk.usage) {
				lastUsage = chunk.usage
			}
		}

		if (lastUsage) {
			const usage = lastUsage as OpenAI.CompletionUsage
			const inputTokens = usage.prompt_tokens || 0
			const outputTokens = usage.completion_tokens || 0
			const totalCost = calculateApiCostOpenAI(model.info, inputTokens, outputTokens)

			yield {
				type: "usage",
				inputTokens: inputTokens,
				outputTokens: outputTokens,
				totalCost: totalCost,
			}
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.cortecsModelId
		const modelInfo = this.options.cortecsModelInfo
		if (modelId && modelInfo) {
			return { id: modelId, info: modelInfo }
		}
		return { id: cortecsDefaultModelId, info: cortecsDefaultModelInfo }
	}
}
