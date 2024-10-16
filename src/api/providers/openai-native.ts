import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { ApiHandler } from "../"
import {
	ApiHandlerOptions,
	ModelInfo,
	openAiNativeDefaultModelId,
	OpenAiNativeModelId,
	openAiNativeModels,
} from "../../shared/api"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

export class OpenAiNativeHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: OpenAI

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new OpenAI({
			apiKey: this.options.openAiNativeApiKey,
		})
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		let systemPromptMessage: OpenAI.Chat.ChatCompletionMessageParam
		let temperature = 0
		switch (this.getModel().id) {
			case "o1-preview":
			case "o1-mini":
				systemPromptMessage = { role: "user", content: systemPrompt }
				temperature = 1
				break
			default:
				systemPromptMessage = { role: "system", content: systemPrompt }
				temperature = 0
		}

		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			systemPromptMessage,
			...convertToOpenAiMessages(messages),
		]

		const stream = await this.client.chat.completions.create({
			model: this.getModel().id,
			// max_completion_tokens: this.getModel().info.maxTokens,
			temperature,
			messages: openAiMessages,
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

			// contains a null value except for the last chunk which contains the token usage statistics for the entire request
			if (chunk.usage) {
				yield {
					type: "usage",
					inputTokens: chunk.usage.prompt_tokens || 0,
					outputTokens: chunk.usage.completion_tokens || 0,
				}
			}
		}
	}

	getModel(): { id: OpenAiNativeModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in openAiNativeModels) {
			const id = modelId as OpenAiNativeModelId
			return { id, info: openAiNativeModels[id] }
		}
		return { id: openAiNativeDefaultModelId, info: openAiNativeModels[openAiNativeDefaultModelId] }
	}
}
