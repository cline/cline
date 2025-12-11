import { FireworksModelId, fireworksDefaultModelId, fireworksModels, ModelInfo } from "@shared/api"
import OpenAI from "openai"
import { ClineStorageMessage } from "@/shared/messages/content"
import { fetch } from "@/shared/net"
import { ApiHandler, CommonApiHandlerOptions } from ".."
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

interface FireworksHandlerOptions extends CommonApiHandlerOptions {
	fireworksApiKey?: string
	fireworksModelId?: string
	fireworksModelMaxCompletionTokens?: number
	fireworksModelMaxTokens?: number
}

export class FireworksHandler implements ApiHandler {
	private options: FireworksHandlerOptions
	private client: OpenAI | undefined

	constructor(options: FireworksHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.fireworksApiKey) {
				throw new Error("Fireworks API key is required")
			}
			try {
				this.client = new OpenAI({
					baseURL: "https://api.fireworks.ai/inference/v1",
					apiKey: this.options.fireworksApiKey,
					fetch, // Use configured fetch with proxy support
				})
			} catch (error) {
				throw new Error(`Error creating Fireworks client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[]): ApiStream {
		const client = this.ensureClient()
		const modelId = this.options.fireworksModelId ?? ""

		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		const stream = await client.chat.completions.create({
			model: modelId,
			messages: openAiMessages,
			stream: true,
			stream_options: { include_usage: true },
			temperature: 0,
		})

		let reasoning: string | null = null
		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta
			if (reasoning || delta?.content?.includes("<think>")) {
				reasoning = (reasoning || "") + (delta.content ?? "")
			}

			if (delta?.content && !reasoning) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			if (reasoning || ("reasoning_content" in delta && delta.reasoning_content)) {
				yield {
					type: "reasoning",
					reasoning: delta.content || ((delta as any).reasoning_content as string | undefined) || "",
				}
				if (reasoning?.includes("</think>")) {
					// Reset so the next chunk is regular content
					reasoning = null
				}
			}

			if (chunk.usage) {
				yield {
					type: "usage",
					inputTokens: chunk.usage.prompt_tokens || 0, // (deepseek reports total input AND cache reads/writes, see context caching: https://api-docs.deepseek.com/guides/kv_cache) where the input tokens is the sum of the cache hits/misses, while anthropic reports them as separate tokens. This is important to know for 1) context management truncation algorithm, and 2) cost calculation (NOTE: we report both input and cache stats but for now set input price to 0 since all the cost calculation will be done using cache hits/misses)
					outputTokens: chunk.usage.completion_tokens || 0,
					// @ts-expect-error-next-line
					cacheReadTokens: chunk.usage.prompt_cache_hit_tokens || 0,
					// @ts-expect-error-next-line
					cacheWriteTokens: chunk.usage.prompt_cache_miss_tokens || 0,
				}
			}
		}
	}

	getModel(): { id: FireworksModelId; info: ModelInfo } {
		const modelId = this.options.fireworksModelId
		if (modelId && modelId in fireworksModels) {
			const id = modelId as FireworksModelId
			return { id, info: fireworksModels[id] }
		}
		return {
			id: fireworksDefaultModelId,
			info: fireworksModels[fireworksDefaultModelId],
		}
	}
}
