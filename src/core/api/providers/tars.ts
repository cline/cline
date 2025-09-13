import { Anthropic } from "@anthropic-ai/sdk"
import { ModelInfo, tarsDefaultModelId, tarsDefaultModelInfo } from "@shared/api"
import { calculateApiCostOpenAI } from "@utils/cost"
import OpenAI from "openai"
import { ApiHandler, CommonApiHandlerOptions } from "../index"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

// Valid reasoning effort levels for TARS.
type ReasoningEffort = "low" | "medium" | "high"

// TARS provider configuration constants.
const TARS_CONFIG = {
	baseURL: "https://api.router.tetrate.ai/v1",
	defaultHeaders: {
		"HTTP-Referer": "https://cline.bot",
		"X-Title": "Cline",
	} as const,
	defaultReasoningEffort: "medium" as ReasoningEffort,
	// Matches OpenAI models that support reasoning_effort parameter: o3/o4 series and gpt-5 series (excludes o1 models which don't support reasoning_effort).
	reasoningModelPattern: /^(o[34](?:-(?:mini|preview|pro)(?:-high)?)?|gpt-5(?:-(?:mini|nano))?)(?:-\d{4}-\d{2}-\d{2})?$/,
} as const

interface TarsHandlerOptions extends CommonApiHandlerOptions {
	tarsApiKey?: string
	reasoningEffort?: string
	tarsModelId?: string
	tarsModelInfo?: ModelInfo
}

// Extended usage interface for TARS-specific response data.
interface TarsUsage extends OpenAI.CompletionUsage {
	prompt_tokens_details?: {
		caching_tokens?: number
		cached_tokens?: number
	}
	total_cost?: number
}

// Type for reasoning arguments that can be passed to OpenAI API.
type ReasoningArgs =
	| {
			reasoning_effort: ReasoningEffort
	  }
	| Record<string, never>

export class TarsHandler implements ApiHandler {
	private options: TarsHandlerOptions
	private client: OpenAI | undefined

	constructor(options: TarsHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.tarsApiKey) {
				throw new Error("TARS API key is required")
			}

			try {
				this.client = new OpenAI({
					baseURL: TARS_CONFIG.baseURL,
					apiKey: this.options.tarsApiKey,
					defaultHeaders: TARS_CONFIG.defaultHeaders,
				})
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : String(error)
				throw new Error(`Error creating TARS client: ${errorMessage}`)
			}
		}
		return this.client
	}

	private buildReasoningArgs(modelId: string): ReasoningArgs {
		const reasoningEffort = (this.options.reasoningEffort as ReasoningEffort) || TARS_CONFIG.defaultReasoningEffort
		const supportsReasoningEffort = TARS_CONFIG.reasoningModelPattern.test(modelId)

		return supportsReasoningEffort ? { reasoning_effort: reasoningEffort } : {}
	}

	private isReasoningModel(modelId: string): boolean {
		return TARS_CONFIG.reasoningModelPattern.test(modelId)
	}

	private processUsageData(usage: TarsUsage, modelInfo: ModelInfo) {
		const inputTokens = usage.prompt_tokens || 0
		const outputTokens = usage.completion_tokens || 0
		const cacheWriteTokens = usage.prompt_tokens_details?.caching_tokens
		const cacheReadTokens = usage.prompt_tokens_details?.cached_tokens

		// Prefer server-provided total_cost if available, otherwise calculate locally.
		const totalCost =
			typeof usage.total_cost === "number"
				? usage.total_cost
				: calculateApiCostOpenAI(modelInfo, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens)

		return {
			type: "usage" as const,
			inputTokens,
			outputTokens,
			cacheWriteTokens,
			cacheReadTokens,
			totalCost,
		}
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const client = this.ensureClient()
		const model = this.getModel()

		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		const reasoningArgs = this.buildReasoningArgs(model.id)
		const isReasoning = this.isReasoningModel(model.id)

		const baseApiParams = {
			model: model.id,
			messages: openAiMessages,
			stream: true as const,
			stream_options: { include_usage: true },
			...reasoningArgs,
		}

		// Build final parameters based on whether it's a openai reasoning model
		const stream = isReasoning
			? // OpenAI reasoning models don't support max_tokens and temperature parameters
				await client.chat.completions.create(baseApiParams)
			: await client.chat.completions.create({
					...baseApiParams,
					max_tokens: model.info.maxTokens || undefined,
					temperature: 0,
				})

		let lastUsage: TarsUsage | undefined

		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta

			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			// Handle reasoning content with proper type checking.
			if (delta && "reasoning_content" in delta && delta.reasoning_content) {
				yield {
					type: "reasoning",
					reasoning: String(delta.reasoning_content || ""),
				}
			}

			if (chunk.usage) {
				lastUsage = chunk.usage as TarsUsage
			}
		}

		if (lastUsage) {
			yield this.processUsageData(lastUsage, model.info)
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		const { tarsModelId, tarsModelInfo } = this.options

		if (tarsModelId && tarsModelInfo) {
			return { id: tarsModelId, info: tarsModelInfo }
		}

		return { id: tarsDefaultModelId, info: tarsDefaultModelInfo }
	}
}
