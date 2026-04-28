import { DeepSeekModelId, deepSeekDefaultModelId, deepSeekModels, ModelInfo, OpenAiCompatibleModelInfo } from "@shared/api"
import { normalizeOpenaiReasoningEffort } from "@shared/storage/types"
import { calculateApiCostOpenAI } from "@utils/cost"
import OpenAI from "openai"
import type { ChatCompletionReasoningEffort, ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import { buildExternalBasicHeaders } from "@/services/EnvUtils"
import { ClineStorageMessage } from "@/shared/messages/content"
import { fetch } from "@/shared/net"
import { ApiFormat } from "@/shared/proto/cline/models"
import { Logger } from "@/shared/services/Logger"
import { ApiHandler, CommonApiHandlerOptions } from "../"
import { RetriableError, withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { addReasoningContent } from "../transform/r1-format"
import { ApiStream } from "../transform/stream"
import { getOpenAIToolParams, ToolCallProcessor } from "../transform/tool-call-processor"

type DeepSeekReasoningEffort = "high" | "max"

interface DeepSeekHandlerOptions extends CommonApiHandlerOptions {
	deepSeekApiKey?: string
	deepSeekBaseUrl?: string
	apiModelId?: string
	reasoningEffort?: string
	thinkingBudgetTokens?: number
}

/**
 * DeepSeek API handler implementing OpenAI-compatible chat completions.
 *
 * ## Billing Model Differences (DeepSeek vs Anthropic)
 *
 * DeepSeek reports total input tokens as the sum of cache hits and misses:
 *   `prompt_tokens = cache_hit_tokens + cache_miss_tokens`
 *
 * Anthropic reports them separately:
 *   `input_tokens = non-cached tokens` (cache_read/write are separate fields)
 *
 * This affects:
 * 1. Context management truncation — `inputTokens` is always 0 for DeepSeek,
 *    so truncation decisions must rely on `cacheReadTokens` and `cacheWriteTokens`
 *    as proxies for actual prompt processing cost.
 * 2. Cost calculation — uses the OpenAI formula which expects `prompt_tokens`,
 *    `cache_hit_tokens`, and `cache_miss_tokens`.
 *
 * @see https://api-docs.deepseek.com/guides/kv_cache
 */
export class DeepSeekHandler implements ApiHandler {
	private options: DeepSeekHandlerOptions
	private client: OpenAI | undefined
	private abortController: AbortController | null = null

	constructor(options: DeepSeekHandlerOptions) {
		this.options = options
	}

	abort(): void {
		this.abortController?.abort()
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.deepSeekApiKey) {
				throw new Error("DeepSeek API key is required")
			}
			try {
				this.client = new OpenAI({
					baseURL: this.options.deepSeekBaseUrl || "https://api.deepseek.com",
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
		// DeepSeek reports total input AND cache reads/writes,
		// see context caching: https://api-docs.deepseek.com/guides/kv_cache
		// where the input tokens (prompt_tokens) is the sum of cache hits and misses, just like OpenAI.
		//
		// DeepSeek's caching model differs from Anthropic's:
		//   - Anthropic: input_tokens = non-cached tokens (separate cache_read/write tokens)
		//   - DeepSeek: prompt_tokens = cache_hit_tokens + cache_miss_tokens (no non-cached input)
		//
		// For context management, we report cacheWriteTokens (cache misses) as inputTokens
		// since cache misses represent the actual new prompt tokens that consume context window.
		// Reporting 0 (as the non-cached remainder would be) makes context truncation unable to
		// detect when the window is filling up.
		//
		// Cost calculation uses the OpenAI formula which expects prompt_tokens,
		// cache_hit_tokens, and cache_miss_tokens.

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
		// Cache miss tokens are the actual new input that consumes context window.
		// Report them as inputTokens so context management can properly track window usage
		// for truncation decisions. Cache hits don't count toward the window.
		yield {
			type: "usage",
			inputTokens: cacheWriteTokens,
			outputTokens: outputTokens,
			cacheWriteTokens: cacheWriteTokens,
			cacheReadTokens: cacheReadTokens,
			totalCost: totalCost,
		}
	}

	/**
	 * Maps OpenAI-standard reasoning effort levels to DeepSeek V4 Pro supported values.
	 * DeepSeek V4 Pro only supports "high" and "max".
	 * - "none" → undefined (disables reasoning)
	 * - "xhigh" → "max"
	 * - Any other value (low/medium/high) → "high"
	 */
	private toDeepSeekReasoningEffort(effort?: string): DeepSeekReasoningEffort | undefined {
		const normalized = normalizeOpenaiReasoningEffort(effort)
		if (normalized === "none") {
			return undefined
		}
		return normalized === "xhigh" ? "max" : "high"
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: OpenAITool[]): ApiStream {
		const client = this.ensureClient()
		const model = this.getModel()

		const modelInfo = model.info as OpenAiCompatibleModelInfo
		// Use apiFormat to detect R1 format requirements instead of the isR1FormatRequired flag,
		// which provides a more consistent format detection mechanism across providers.
		const isDeepseekReasoner = modelInfo.apiFormat === ApiFormat.R1_CHAT
		const isDeepseekV4Pro = modelInfo.supportsReasoningEffort === true

		const convertedMessages = convertToOpenAiMessages(messages)
		// Models that support reasoning (R1 via apiFormat, V4 Pro via supportsReasoning)
		// must pass reasoning_content back in subsequent turns to maintain chain continuity.
		const needsReasoningContent = isDeepseekReasoner || modelInfo.supportsReasoning === true
		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = needsReasoningContent
			? [{ role: "system", content: systemPrompt }, ...addReasoningContent(convertedMessages, messages)]
			: [{ role: "system", content: systemPrompt }, ...convertedMessages]

		const reasoningEffort = isDeepseekV4Pro ? this.toDeepSeekReasoningEffort(this.options.reasoningEffort) : undefined

		const maxTokens = model.info.maxTokens

		this.abortController = new AbortController()

		const stream = await client.chat.completions.create(
			{
				model: model.id,
				max_completion_tokens: maxTokens,
				messages: openAiMessages,
				stream: true,
				stream_options: { include_usage: true },
				// Only set temperature for non-reasoner models (reasoner uses R1 format which doesn't support temperature)
				...(isDeepseekReasoner ? {} : { temperature: 0 }),
				...(reasoningEffort ? { reasoning_effort: reasoningEffort as ChatCompletionReasoningEffort } : {}),
				...getOpenAIToolParams(tools),
			},
			{ signal: this.abortController.signal },
		)

		const toolCallProcessor = new ToolCallProcessor()

		try {
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
					yield {
						type: "reasoning",
						reasoning: (delta.reasoning_content as string | undefined) || "",
					}
				}

				if (chunk.usage) {
					yield* this.yieldUsage(model.info, chunk.usage)
				}
			}
		} catch (error: any) {
			// If the request was intentionally aborted (e.g., user cancelled),
			// silently return instead of delegating to error handling which
			// may trigger retries via the @withRetry() decorator.
			if (error?.name === "AbortError" || this.abortController?.signal.aborted) {
				return
			}
			this.handleStreamError(error)
		}
	}

	/**
	 * Classifies DeepSeek API errors and surfaces actionable messages.
	 * - 400/401/402 → immediately throw non-retriable errors (bad request, auth, balance)
	 * - 429/500/502/503/504 → throw RetriableError to trigger exponential backoff retry
	 * - Network errors without HTTP status → throw RetriableError
	 * - Other errors → re-throw as-is (will be caught by @withRetry() decorator)
	 */
	private handleStreamError(error: any): never {
		const status = error?.status

		// Non-retriable errors
		if (status === 400) {
			throw new Error(`DeepSeek API bad request (400): ${error.message}`)
		}
		if (status === 401) {
			throw new Error(`DeepSeek API unauthorized (401): Check your API key.`)
		}
		if (status === 402) {
			throw new Error(
				"DeepSeek API error (402): Insufficient balance. Please top up your account at https://platform.deepseek.com.",
			)
		}

		// Retriable errors — trigger @withRetry() exponential backoff
		if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
			throw new RetriableError(`DeepSeek API error (${status}): ${error.message}`)
		}

		// Network errors without HTTP status (e.g., connection reset, DNS failure)
		if (
			!status &&
			(error?.message?.includes("fetch") ||
				error?.message?.includes("network") ||
				error?.code === "ECONNRESET" ||
				error?.code === "ETIMEDOUT")
		) {
			throw new RetriableError(`DeepSeek network error: ${error.message}`)
		}

		throw error
	}

	getModel(): { id: DeepSeekModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in deepSeekModels) {
			const id = modelId as DeepSeekModelId
			return { id, info: deepSeekModels[id] }
		}
		if (modelId) {
			Logger.warn(
				`[DeepSeekHandler] Model ID "${modelId}" not found in deepSeekModels, falling back to default "${deepSeekDefaultModelId}"`,
			)
		}
		return {
			id: deepSeekDefaultModelId,
			info: deepSeekModels[deepSeekDefaultModelId],
		}
	}
}
