import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { MinimaxModelId, ModelInfo, minimaxDefaultModelId, minimaxModels } from "@/shared/api"
import { ApiHandler, CommonApiHandlerOptions } from "../index"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

interface MinimaxHandlerOptions extends CommonApiHandlerOptions {
	minimaxApiKey?: string
	minimaxApiLine?: string
	apiModelId?: string
}

export class MinimaxHandler implements ApiHandler {
	private client: OpenAI | undefined

	constructor(private readonly options: MinimaxHandlerOptions) {}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.minimaxApiKey) {
				throw new Error("MiniMax API key is required")
			}
			try {
				this.client = new OpenAI({
					baseURL:
						this.options.minimaxApiLine === "china" ? "https://api.minimaxi.com/v1" : "https://api.minimax.io/v1",
					apiKey: this.options.minimaxApiKey,
				})
			} catch (error) {
				throw new Error(`Error creating MiniMax client: ${error.message}`)
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
			max_tokens: model.info.maxTokens,
			stream: true,
			stream_options: { include_usage: true },
		})
		const startTag: string = "<think>"
		const endTag: string = "</think>"
		let isInThinkingMode: boolean = false

		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta
			if (delta?.content) {
				let content: string = delta.content

				// Check if thinking mode starts
				if (content.startsWith(startTag)) {
					isInThinkingMode = true
					content = content.replace(startTag, "")
				}

				if (isInThinkingMode) {
					// Check if thinking mode ends
					const endIndex: number = content.indexOf(endTag)
					if (endIndex > -1) {
						isInThinkingMode = false
						const beforeThink = content.slice(0, endIndex)
						const afterThink = content.slice(endIndex + endTag.length)

						// Output thinking content
						if (beforeThink) {
							yield {
								type: "reasoning",
								reasoning: beforeThink,
							}
						}

						// Output content after thinking ends
						if (afterThink) {
							yield {
								type: "text",
								text: afterThink,
							}
						}
						continue
					}

					// Still in thinking mode, output reasoning
					if (content) {
						yield {
							type: "reasoning",
							reasoning: content,
						}
					}
					continue
				}

				// Normal text mode
				yield {
					type: "text",
					text: content,
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
					// @ts-ignore-next-line
					cacheReadTokens: chunk.usage.prompt_cache_hit_tokens || 0,
					// @ts-ignore-next-line
					cacheWriteTokens: chunk.usage.prompt_cache_miss_tokens || 0,
				}
			}
		}
	}

	getModel(): { id: MinimaxModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId

		if (modelId && modelId in minimaxModels) {
			const id = modelId as MinimaxModelId
			return { id, info: minimaxModels[id] }
		}
		return { id: minimaxDefaultModelId, info: minimaxModels[minimaxDefaultModelId] }
	}
}
