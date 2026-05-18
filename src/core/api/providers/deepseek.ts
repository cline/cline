import { DeepSeekModelId, deepSeekDefaultModelId, deepSeekModels, ModelInfo } from "@shared/api"
import { calculateApiCostOpenAI } from "@utils/cost"
import OpenAI from "openai"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import { buildExternalBasicHeaders } from "@/services/EnvUtils"
import { ClineStorageMessage } from "@/shared/messages/content"
import { fetch } from "@/shared/net"
import { ApiHandler, CommonApiHandlerOptions } from "../"
import { withRetry } from "../retry"
import { convertDeepSeekMessages, convertDeepseekToOpenAiMessages } from "../transform/deepseek-format"
import { ApiStream } from "../transform/stream"
import { getOpenAIToolParams, ToolCallProcessor } from "../transform/tool-call-processor"

interface DeepSeekHandlerOptions extends CommonApiHandlerOptions {
	deepSeekApiKey?: string
	apiModelId?: string
	reasoningEffort?: string
}

export class DeepSeekHandler implements ApiHandler {
	private options: DeepSeekHandlerOptions
	private client: OpenAI | undefined

	constructor(options: DeepSeekHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.deepSeekApiKey) {
				throw new Error("DeepSeek API key is required")
			}
			try {
				this.client = new OpenAI({
					baseURL: "https://api.deepseek.com",
					apiKey: this.options.deepSeekApiKey,
					defaultHeaders: buildExternalBasicHeaders(),
					fetch, // Use configured fetch with proxy support
				})
			} catch (error) {
				throw new Error(`Error creating DeepSeek client: ${error.message}`)
			}
		}
		return this.client
	}

	private async *yieldUsage(info: ModelInfo, usage: OpenAI.Completions.CompletionUsage | undefined): ApiStream {
		// Deepseek reports total input AND cache reads/writes,
		// see context caching: https://api-docs.deepseek.com/guides/kv_cache)
		// where the input tokens is the sum of the cache hits/misses, just like OpenAI.
		// This affects:
		// 1) context management truncation algorithm, and
		// 2) cost calculation

		// Deepseek usage includes extra fields.
		// Safely cast the prompt token details section to the appropriate structure.
		interface DeepSeekUsage extends OpenAI.CompletionUsage {
			prompt_cache_hit_tokens?: number
			prompt_cache_miss_tokens?: number
		}
		const deepUsage = usage as DeepSeekUsage

		const inputTokens = deepUsage?.prompt_tokens || 0 // sum of cache hits and misses
		const outputTokens = deepUsage?.completion_tokens || 0
		const cacheReadTokens = deepUsage?.prompt_cache_hit_tokens || 0
		const cacheWriteTokens = deepUsage?.prompt_cache_miss_tokens || 0
		const totalCost = calculateApiCostOpenAI(info, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens)
		const nonCachedInputTokens = Math.max(0, inputTokens - cacheReadTokens - cacheWriteTokens) // this will always be 0
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
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: OpenAITool[]): ApiStream {
		const client = this.ensureClient()
		const model = this.getModel()

		const isThinkingEnabled = this.options.reasoningEffort && this.options.reasoningEffort !== "none"
		const reasoningEffort = isThinkingEnabled
			? (this.options.reasoningEffort as OpenAI.ChatCompletionReasoningEffort)
			: undefined
		const supportsReasoning = model.info.supportsReasoning ?? false

		// All deepseek models now use the same message conversion: V4-native format when thinking is on,
		// plain OpenAI format otherwise. deepseek-chat and deepseek-reasoner are deprecated as of 2026-07-24.
		// Only call the appropriate converter to avoid unnecessary warnings from skipping
		// pure-thinking messages in the non-thinking converter when thinking is actually enabled.
		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = isThinkingEnabled
			? convertDeepSeekMessages(messages, systemPrompt)
			: [{ role: "system", content: systemPrompt }, ...convertDeepseekToOpenAiMessages(messages)]
		const stream = await client.chat.completions.create({
			model: model.id,
			max_completion_tokens: model.info.maxTokens,
			messages: openAiMessages,
			stream: true,
			stream_options: { include_usage: true },
			...(supportsReasoning ? {} : { temperature: 0 }),
			...getOpenAIToolParams(tools),
			...(supportsReasoning
				? {
						extra_body: {
							thinking: { type: isThinkingEnabled ? "enabled" : "disabled" },
						},
						...(isThinkingEnabled ? { reasoning_effort: reasoningEffort } : {}),
					}
				: {}),
		})

		const toolCallProcessor = new ToolCallProcessor()

		for await (const chunk of stream) {
			const delta = chunk.choices?.[0]?.delta
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			if (delta?.tool_calls) {
				yield* toolCallProcessor.processToolCallDeltas(delta.tool_calls)
			}

			if (delta && "reasoning_content" in delta && delta.reasoning_content) {
				const shouldYieldReasoning = this.options.reasoningEffort && this.options.reasoningEffort !== "none"
				if (shouldYieldReasoning) {
					yield {
						type: "reasoning",
						reasoning: (delta.reasoning_content as string | undefined) || "",
					}
				}
			}

			if (chunk.usage) {
				yield* this.yieldUsage(model.info, chunk.usage)
			}
		}
	}

	getModel(): { id: DeepSeekModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		// Smooth migration from deprecated model names to v4-flash:
		// deepseek-chat → deepseek-v4-flash (non-thinking, reasoningEffort=none by default)
		// deepseek-reasoner → deepseek-v4-flash (thinking, existing reasoningEffort setting preserved)
		// Both now resolve to v4-flash; thinking is controlled solely by reasoningEffort.
		if (modelId && modelId in deepSeekModels) {
			const id = modelId as DeepSeekModelId
			return { id, info: deepSeekModels[id] }
		}
		return {
			id: deepSeekDefaultModelId,
			info: deepSeekModels[deepSeekDefaultModelId],
		}
	}
}
