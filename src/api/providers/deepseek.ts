import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { ApiHandlerOptions, ModelInfo, deepSeekModels, deepSeekDefaultModelId } from "../../shared/api"
import { ApiHandler } from "../index"
import { ApiStream } from "../transform/stream"

export class DeepSeekHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: OpenAI

	constructor(options: ApiHandlerOptions) {
		this.options = options
		if (!options.deepSeekApiKey) {
			throw new Error("DeepSeek API key is required. Please provide it in the settings.")
		}
		this.client = new OpenAI({
			baseURL: this.options.deepSeekBaseUrl ?? "https://api.deepseek.com/v1",
			apiKey: this.options.deepSeekApiKey,
		})
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const modelInfo = deepSeekModels[this.options.deepSeekModelId as keyof typeof deepSeekModels] || deepSeekModels[deepSeekDefaultModelId]

		// Format all messages
		const messagesToInclude: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: 'system' as const, content: systemPrompt }
		]

		// Add the rest of the messages
		for (const msg of messages) {
			let messageContent = ""
			if (typeof msg.content === "string") {
				messageContent = msg.content
			} else if (Array.isArray(msg.content)) {
				messageContent = msg.content.reduce((acc, part) => {
					if (part.type === "text") {
						return acc + part.text
					}
					return acc
				}, "")
			}
			
			messagesToInclude.push({
				role: msg.role === 'user' ? 'user' as const : 'assistant' as const,
				content: messageContent
			})
		}

		const requestOptions: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
			model: this.options.deepSeekModelId ?? "deepseek-chat",
			messages: messagesToInclude,
			temperature: 0,
			stream: true,
			max_tokens: modelInfo.maxTokens,
		}

		if (this.options.includeStreamOptions ?? true) {
			requestOptions.stream_options = { include_usage: true }
		}

		let totalInputTokens = 0;
		let totalOutputTokens = 0;

		try {
			const stream = await this.client.chat.completions.create(requestOptions)
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
		} catch (error) {
			console.error("DeepSeek API Error:", error)
			throw error
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.deepSeekModelId ?? deepSeekDefaultModelId
		return {
			id: modelId,
			info: deepSeekModels[modelId as keyof typeof deepSeekModels] || deepSeekModels[deepSeekDefaultModelId],
		}
	}
}
