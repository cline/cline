import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { withRetry } from "../retry"
import { ApiHandler } from "../index"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import { ModelInfo, MoonshotModelId, moonshotModels, moonshotDefaultModelId } from "@/shared/api"

interface MoonshotHandlerOptions {
	moonshotApiKey?: string
	moonshotApiLine?: string
	apiModelId?: string
}

export class MoonshotHandler implements ApiHandler {
	private client: OpenAI | undefined

	constructor(private readonly options: MoonshotHandlerOptions) {}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.moonshotApiKey) {
				throw new Error("Moonshot API key is required")
			}
			try {
				this.client = new OpenAI({
					baseURL:
						this.options.moonshotApiLine === "china" ? "https://api.moonshot.cn/v1" : "https://api.moonshot.ai/v1",
					apiKey: this.options.moonshotApiKey,
				})
			} catch (error) {
				throw new Error(`Error creating Moonshot client: ${error.message}`)
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

	getModel(): { id: MoonshotModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId

		if (modelId && modelId in moonshotModels) {
			const id = modelId as MoonshotModelId
			return { id, info: moonshotModels[id] }
		}
		return { id: moonshotDefaultModelId, info: moonshotModels[moonshotDefaultModelId] }
	}
}
