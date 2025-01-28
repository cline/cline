import { Anthropic } from "@anthropic-ai/sdk"
import { Stream as AnthropicStream } from "@anthropic-ai/sdk/streaming"
import { ApiHandler } from "../"
import { ApiHandlerOptions, ModelInfo } from "../../shared/api"
import { ApiStream } from "../transform/stream"

export class ClineHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: Anthropic

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new Anthropic({
			apiKey: this.options.clineApiKey || "",
			baseURL: "https://api.cline.bot/v1",
			defaultHeaders: {
				"X-Firebase-Token": this.options.authToken || "",
			},
		})
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const model = this.getModel()
		const stream = await this.client.messages.create({
			model: model.id,
			max_tokens: model.info.maxTokens || 8192,
			temperature: 0,
			system: [{ text: systemPrompt, type: "text" }],
			messages,
			stream: true,
		})

		for await (const chunk of stream) {
			switch (chunk.type) {
				case "message_start":
					const usage = chunk.message.usage as any
					const result: any = {
						type: "usage",
						inputTokens: usage.input_tokens || 0,
						outputTokens: usage.output_tokens || 0,
					}
					if (usage.cache_creation_input_tokens) {
						result.cacheWriteTokens = usage.cache_creation_input_tokens
					}
					if (usage.cache_read_input_tokens) {
						result.cacheReadTokens = usage.cache_read_input_tokens
					}
					yield result
					break
				case "message_delta":
					yield {
						type: "usage",
						inputTokens: 0,
						outputTokens: chunk.usage.output_tokens || 0,
					}
					break
				case "content_block_start":
					switch (chunk.content_block.type) {
						case "text":
							if (chunk.index > 0) {
								yield {
									type: "text",
									text: "\n",
								}
							}
							yield {
								type: "text",
								text: chunk.content_block.text,
							}
							break
					}
					break
				case "content_block_delta":
					switch (chunk.delta.type) {
						case "text_delta":
							yield {
								type: "text",
								text: chunk.delta.text,
							}
							break
					}
					break
			}
		}
	}

	getModel() {
		return {
			id: "claude-3-5-sonnet",
			info: {
				maxTokens: 8192,
				contextWindow: 200_000,
				supportsImages: true,
				supportsComputerUse: true,
				supportsPromptCache: true,
				inputPrice: 3.0,
				outputPrice: 15.0,
				cacheWritesPrice: 3.75,
				cacheReadsPrice: 0.3,
			},
		}
	}
}
