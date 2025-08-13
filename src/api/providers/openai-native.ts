import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { withRetry } from "../retry"
import { ApiHandler } from "../"
import { ApiHandlerOptions, ModelInfo, openAiNativeDefaultModelId, OpenAiNativeModelId, openAiNativeModels } from "@shared/api"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { calculateApiCostOpenAI } from "../../utils/cost"
import { ApiStream } from "../transform/stream"
import type { ChatCompletionReasoningEffort } from "openai/resources/chat/completions"

interface OpenAiNativeHandlerOptions {
	openAiNativeApiKey?: string
	reasoningEffort?: string
	apiModelId?: string
}

export class OpenAiNativeHandler implements ApiHandler {
	private options: OpenAiNativeHandlerOptions
	private client: OpenAI | undefined

	constructor(options: OpenAiNativeHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.openAiNativeApiKey) {
				throw new Error("OpenAI API key is required")
			}
			try {
				this.client = new OpenAI({
					apiKey: this.options.openAiNativeApiKey,
				})
			} catch (error: any) {
				throw new Error(`Error creating OpenAI client: ${error.message}`)
			}
		}
		return this.client
	}

	private async *yieldUsage(info: ModelInfo, usage: OpenAI.Completions.CompletionUsage | undefined): ApiStream {
		const inputTokens = usage?.prompt_tokens || 0 // sum of cache hits and misses
		const outputTokens = usage?.completion_tokens || 0
		const cacheReadTokens = usage?.prompt_tokens_details?.cached_tokens || 0
		const cacheWriteTokens = 0
		const totalCost = calculateApiCostOpenAI(info, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens)
		const nonCachedInputTokens = Math.max(0, inputTokens - cacheReadTokens - cacheWriteTokens)
		yield {
			type: "usage",
			inputTokens: nonCachedInputTokens,
			outputTokens: outputTokens,
			cacheWriteTokens: cacheWriteTokens,
			cacheReadTokens: cacheReadTokens,
			totalCost: totalCost,
		}
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const client = this.ensureClient()
		const model = this.getModel()

		switch (model.id) {
			case "o1":
			case "o1-preview":
			case "o1-mini": {
				// o1 doesn't support streaming, non-1 temp, or system prompt
				const response = await client.chat.completions.create({
					model: model.id,
					messages: [{ role: "user", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
				})
				yield {
					type: "text",
					text: response.choices[0]?.message.content || "",
				}

				yield* this.yieldUsage(model.info, response.usage)

				break
			}
			case "o4-mini":
			case "o3":
			case "o3-mini": {
				const stream = await client.chat.completions.create({
					model: model.id,
					messages: [{ role: "developer", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
					stream: true,
					stream_options: { include_usage: true },
					reasoning_effort: (this.options.reasoningEffort as ChatCompletionReasoningEffort) || "medium",
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
						// Only last chunk contains usage
						yield* this.yieldUsage(model.info, chunk.usage)
					}
				}
				break
			}
			case "nectarine-alpha-new-reasoning-effort-2025-07-25":
			case "gpt-5-2025-08-07":
			case "gpt-5-mini-2025-08-07":
			case "gpt-5-nano-2025-08-07":
				const stream = await client.chat.completions.create({
					model: model.id,
					temperature: 1,
					messages: [{ role: "developer", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
					stream: true,
					stream_options: { include_usage: true },
					reasoning_effort: (this.options.reasoningEffort as ChatCompletionReasoningEffort) || "medium",
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
						// Only last chunk contains usage
						yield* this.yieldUsage(model.info, chunk.usage)
					}
				}
				break
			default: {
				const stream = await client.chat.completions.create({
					model: model.id,
					// max_completion_tokens: this.getModel().info.maxTokens,
					temperature: 0,
					messages: [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
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
						// Only last chunk contains usage
						yield* this.yieldUsage(model.info, chunk.usage)
					}
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
		return {
			id: openAiNativeDefaultModelId,
			info: openAiNativeModels[openAiNativeDefaultModelId],
		}
	}
}
