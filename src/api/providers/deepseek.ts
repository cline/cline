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
		// Convert messages to simple format that DeepSeek expects
		const formattedMessages = messages.map(msg => {
			if (typeof msg.content === "string") {
				return { role: msg.role, content: msg.content }
			}
			// For array content, concatenate text parts
			return {
				role: msg.role,
				content: msg.content.reduce((acc, part) => {
					if (part.type === "text") {
						return acc + part.text
					}
					return acc
				}, "")
			}
		})

		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...formattedMessages,
		]
		const modelInfo = deepSeekModels[this.options.deepSeekModelId as keyof typeof deepSeekModels] || deepSeekModels[deepSeekDefaultModelId]
		
		const contextWindow = modelInfo.contextWindow || 64_000
		const getTokenCount = (content: string) => Math.ceil(content.length * 0.3)

		// Always keep system prompt
		const systemMsg = openAiMessages[0]
		let availableTokens = contextWindow - getTokenCount(typeof systemMsg.content === 'string' ? systemMsg.content : '')
		
		// Start with most recent messages and work backwards
		const userMessages = openAiMessages.slice(1).reverse()
		const includedMessages = []
		let truncated = false

		for (const msg of userMessages) {
			const content = typeof msg.content === 'string' ? msg.content : ''
			const tokens = getTokenCount(content)
			
			if (tokens <= availableTokens) {
				includedMessages.unshift(msg)
				availableTokens -= tokens
			} else {
				truncated = true
				break
			}
		}

		if (truncated) {
			yield {
				type: 'text',
				text: '(Note: Some earlier messages were truncated to fit within the model\'s context window)\n\n'
			}
		}

		const requestOptions: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
			model: this.options.deepSeekModelId ?? "deepseek-chat",
			messages: [systemMsg, ...includedMessages],
			temperature: 0,
			stream: true,
			max_tokens: modelInfo.maxTokens,
		}

		if (this.options.includeStreamOptions ?? true) {
			requestOptions.stream_options = { include_usage: true }
		}

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
	}

	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.deepSeekModelId ?? deepSeekDefaultModelId
		return {
			id: modelId,
			info: deepSeekModels[modelId as keyof typeof deepSeekModels] || deepSeekModels[deepSeekDefaultModelId],
		}
	}
}