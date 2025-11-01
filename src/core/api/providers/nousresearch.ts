import { Anthropic } from "@anthropic-ai/sdk"
import { ModelInfo, NousresearchModelId, nousresearchDefaultModelId, nousresearchModels } from "@shared/api"
import OpenAI from "openai"
import { ApiHandler, CommonApiHandlerOptions } from "../index"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

interface NousresearchHandlerOptions extends CommonApiHandlerOptions {
	nousresearchApiKey?: string
	apiModelId?: string
}

export class NousresearchHandler implements ApiHandler {
	private options: NousresearchHandlerOptions
	private client: OpenAI | undefined

	constructor(options: NousresearchHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.nousresearchApiKey) {
				throw new Error("NousResearch API key is required")
			}
			try {
				this.client = new OpenAI({
					baseURL: "https://inference-api.nousresearch.com/v1",
					apiKey: this.options.nousresearchApiKey,
				})
			} catch (error: any) {
				throw new Error(`Error creating NousResearch client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const client = this.ensureClient()
		const model = this.getModel()

		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		const stream = await client.chat.completions.create({
			model: model.id,
			messages: openAiMessages,
			temperature: 0,
			stream: true,
			stream_options: { include_usage: true },
		})

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
				yield {
					type: "usage",
					inputTokens: chunk.usage.prompt_tokens || 0,
					outputTokens: chunk.usage.completion_tokens || 0,
				}
			}
		}
	}

	getModel(): { id: NousresearchModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId

		if (modelId && modelId in nousresearchModels) {
			const id = modelId as NousresearchModelId
			return { id, info: nousresearchModels[id] }
		}
		return { id: nousresearchDefaultModelId, info: nousresearchModels[nousresearchDefaultModelId] }
	}
}
