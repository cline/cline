import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { withRetry } from "../retry"
import { ModelInfo, openAiModelInfoSaneDefaults } from "@shared/api"
import { ApiHandler } from "../index"
import { convertToOpenAiMessages } from "@api/transform/openai-format"
import { ApiStream } from "@api/transform/stream"
import { convertToR1Format } from "@api/transform/r1-format"

interface TogetherHandlerOptions {
	togetherApiKey?: string
	togetherModelId?: string
}

export class TogetherHandler implements ApiHandler {
	private options: TogetherHandlerOptions
	private client: OpenAI | undefined

	constructor(options: TogetherHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.togetherApiKey) {
				throw new Error("Together API key is required")
			}
			try {
				this.client = new OpenAI({
					baseURL: "https://api.together.xyz/v1",
					apiKey: this.options.togetherApiKey,
				})
			} catch (error: any) {
				throw new Error(`Error creating Together client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const client = this.ensureClient()
		const modelId = this.options.togetherModelId ?? ""
		const isDeepseekReasoner = modelId.includes("deepseek-reasoner")

		let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		if (isDeepseekReasoner) {
			openAiMessages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
		}

		const stream = await client.chat.completions.create({
			model: modelId,
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

	getModel(): { id: string; info: ModelInfo } {
		return {
			id: this.options.togetherModelId ?? "",
			info: openAiModelInfoSaneDefaults,
		}
	}
}
