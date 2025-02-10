import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { ApiHandler } from "../"
import { ApiHandlerOptions, ModelInfo, vortnDefaultModelId, vortnDefaultModelInfo } from "../../shared/api"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

export class VortnHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: OpenAI

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new OpenAI({
			baseURL: "https://backend.vortn.com/api/v1/openai",
			apiKey: this.options.vortnApiKey,
			defaultHeaders: {
				"HTTP-Referer": "https://cline.bot", // Optional, for including your app on openrouter.ai rankings.
				"X-Title": "Cline", // Optional. Shows in rankings on openrouter.ai.
			},
		})
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		// Convert Anthropic messages to OpenAI format
		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		// @ts-ignore-next-line
		const stream = await this.client.chat.completions.create({
			model: this.getModel().id,
			max_tokens: 8_192,
			temperature: 0,
			messages: openAiMessages,
			stream: true,
			stream_options: { include_usage: true },
		})

		for await (const chunk of stream) {
			// vortn returns an error object instead of the openai sdk throwing an error
			if ("error" in chunk) {
				const error = chunk.error as { message?: string; code?: number }
				console.error(`Vortn API Error: ${error?.code} - ${error?.message}`)
				throw new Error(`Vortn API Error ${error?.code}: ${error?.message}`)
			}

			const delta = chunk.choices[0]?.delta
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			if (chunk.usage) {
				yield {
					type: "usage",
					inputTokens: chunk.usage.prompt_tokens || 0,
					outputTokens: chunk.usage.completion_tokens || 0,
					totalCost: chunk.usage.total_tokens || 0,
				}
			}
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.vortnModelId
		const modelInfo = this.options.vortnModelInfo
		if (modelId && modelInfo) {
			return { id: modelId, info: modelInfo }
		}
		return {
			id: vortnDefaultModelId,
			info: vortnDefaultModelInfo,
		}
	}
}
