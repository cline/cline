import { ModelInfo, PerplexityModelId, perplexityDefaultModelId, perplexityModels } from "@shared/api"
import OpenAI from "openai"
import { ClineStorageMessage } from "@/shared/messages/content"
import { createOpenAIClient } from "@/shared/net"
import { ApiHandler, CommonApiHandlerOptions } from ".."
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

interface PerplexityHandlerOptions extends CommonApiHandlerOptions {
	perplexityApiKey?: string
	perplexityModelId?: string
}

const PERPLEXITY_BASE_URL = "https://api.perplexity.ai"

function resolvePerplexityApiKey(explicit?: string): string | undefined {
	if (explicit) {
		return explicit
	}
	const fromEnv = process.env.PERPLEXITY_API_KEY ?? process.env.PPLX_API_KEY
	return fromEnv && fromEnv.length > 0 ? fromEnv : undefined
}

export class PerplexityHandler implements ApiHandler {
	private options: PerplexityHandlerOptions
	private client: OpenAI | undefined

	constructor(options: PerplexityHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			const apiKey = resolvePerplexityApiKey(this.options.perplexityApiKey)
			if (!apiKey) {
				throw new Error("Perplexity API key is required")
			}
			try {
				this.client = createOpenAIClient({
					baseURL: PERPLEXITY_BASE_URL,
					apiKey,
				})
			} catch (error: any) {
				throw new Error(`Error creating Perplexity client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[]): ApiStream {
		const client = this.ensureClient()
		const { id: modelId } = this.getModel()

		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		const stream = await client.chat.completions.create({
			model: modelId,
			messages: openAiMessages,
			stream: true,
			stream_options: { include_usage: true },
			...(!(modelId.includes("reasoning")) && { temperature: 0 }),
		})

		for await (const chunk of stream) {
			const delta = chunk.choices?.[0]?.delta as
				| (OpenAI.Chat.Completions.ChatCompletionChunk["choices"][number]["delta"] & {
						reasoning_content?: string
				  })
				| undefined

			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			if (delta?.reasoning_content) {
				yield {
					type: "reasoning",
					reasoning: delta.reasoning_content,
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

	getModel(): { id: PerplexityModelId; info: ModelInfo } {
		const modelId = this.options.perplexityModelId
		if (modelId && modelId in perplexityModels) {
			const id = modelId as PerplexityModelId
			return { id, info: perplexityModels[id] }
		}
		return {
			id: perplexityDefaultModelId,
			info: perplexityModels[perplexityDefaultModelId],
		}
	}
}
