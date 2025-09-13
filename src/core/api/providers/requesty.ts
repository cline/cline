import { Anthropic } from "@anthropic-ai/sdk"
import { ModelInfo, requestyDefaultModelId, requestyDefaultModelInfo } from "@shared/api"
import { calculateApiCostOpenAI } from "@utils/cost"
import OpenAI from "openai"
import { ApiHandler, CommonApiHandlerOptions } from "../index"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

interface RequestyHandlerOptions extends CommonApiHandlerOptions {
	requestyBaseUrl?: string
	requestyApiKey?: string
	reasoningEffort?: string
	thinkingBudgetTokens?: number
	requestyModelId?: string
	requestyModelInfo?: ModelInfo
}

// Requesty usage includes an extra field for Anthropic use cases.
// Safely cast the prompt token details section to the appropriate structure.
interface RequestyUsage extends OpenAI.CompletionUsage {
	prompt_tokens_details?: {
		caching_tokens?: number
		cached_tokens?: number
	}
	total_cost?: number
}

export class RequestyHandler implements ApiHandler {
	private options: RequestyHandlerOptions
	private client: OpenAI | undefined

	constructor(options: RequestyHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.requestyApiKey) {
				throw new Error("Requesty API key is required")
			}
			try {
				this.client = new OpenAI({
					baseURL: this.options.requestyBaseUrl || "https://router.requesty.ai/v1",
					apiKey: this.options.requestyApiKey,
					defaultHeaders: {
						"HTTP-Referer": "https://cline.bot",
						"X-Title": "Cline",
					},
				})
			} catch (error: any) {
				throw new Error(`Error creating Requesty client: ${error.message}`)
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

		const reasoningEffort = this.options.reasoningEffort || "medium"
		const reasoning = { reasoning_effort: reasoningEffort }
		const reasoningArgs = model.id.startsWith("openai/o") ? reasoning : {}

		const thinkingBudget = this.options.thinkingBudgetTokens || 0
		const thinking =
			thinkingBudget > 0
				? { thinking: { type: "enabled", budget_tokens: thinkingBudget } }
				: { thinking: { type: "disabled" } }
		const thinkingArgs =
			model.id.includes("claude-3-7-sonnet") ||
			model.id.includes("claude-sonnet-4") ||
			model.id.includes("claude-opus-4") ||
			model.id.includes("claude-opus-4-1")
				? thinking
				: {}

		// @ts-ignore-next-line
		const stream = await client.chat.completions.create({
			model: model.id,
			max_tokens: model.info.maxTokens || undefined,
			messages: openAiMessages,
			temperature: 0,
			stream: true,
			stream_options: { include_usage: true },
			...reasoningArgs,
			...thinkingArgs,
		})

		let lastUsage: any

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
				lastUsage = chunk.usage
			}
		}

		if (lastUsage) {
			const usage = lastUsage as RequestyUsage
			const inputTokens = usage.prompt_tokens || 0
			const outputTokens = usage.completion_tokens || 0
			const cacheWriteTokens = usage.prompt_tokens_details?.caching_tokens || undefined
			const cacheReadTokens = usage.prompt_tokens_details?.cached_tokens || undefined
			const totalCost = calculateApiCostOpenAI(model.info, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens)

			yield {
				type: "usage",
				inputTokens: inputTokens,
				outputTokens: outputTokens,
				cacheWriteTokens: cacheWriteTokens,
				cacheReadTokens: cacheReadTokens,
				totalCost: totalCost,
			}
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.requestyModelId
		const modelInfo = this.options.requestyModelInfo
		if (modelId && modelInfo) {
			return { id: modelId, info: modelInfo }
		}
		return { id: requestyDefaultModelId, info: requestyDefaultModelInfo }
	}
}
