import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { withRetry } from "../retry"
import { ApiHandlerOptions, ModelInfo, SambanovaModelId, sambanovaDefaultModelId, sambanovaModels } from "../../shared/api"
import { ApiHandler } from "../index"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

export class SambanovaHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: OpenAI

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new OpenAI({
			baseURL: "https://api.sambanova.ai/v1",
			apiKey: this.options.sambanovaApiKey,
		})
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		const stream = await this.client.chat.completions.create({
			model: this.getModel().id,
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

			if (chunk.usage) {
				yield {
					type: "usage",
					inputTokens: chunk.usage.prompt_tokens || 0,
					outputTokens: chunk.usage.completion_tokens || 0,
				}
			}
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in sambanovaModels) {
			const id = modelId as SambanovaModelId
			return { id, info: sambanovaModels[id] }
		}
		return {
			id: sambanovaDefaultModelId,
			info: sambanovaModels[sambanovaDefaultModelId],
		}
	}
}
