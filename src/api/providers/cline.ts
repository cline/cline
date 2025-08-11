import type { Anthropic } from "@anthropic-ai/sdk"
import { type ModelInfo, openRouterDefaultModelId, openRouterDefaultModelInfo } from "@shared/api"
import { shouldSkipReasoningForModel } from "@utils/model-utils"
import axios from "axios"
import OpenAI from "openai"
import type { CompletionUsage } from "openai/resources/completions.mjs"
import type { ChatCompletionChunk } from "openai/resources/index.mjs"
import { clineEnvConfig } from "@/config"
import { ClineAccountService } from "@/services/account/ClineAccountService"
import { AuthService } from "@/services/auth/AuthService"
import { CLINE_ACCOUNT_AUTH_ERROR_MESSAGE } from "@/shared/ClineAccount"
import { version as extensionVersion } from "../../../package.json"
import type { ApiHandler } from "../"
import { withRetry } from "../retry"
import { createOpenRouterStream } from "../transform/openrouter-stream"
import type { ApiStream, ApiStreamUsageChunk } from "../transform/stream"

interface ClineHandlerOptions {
	taskId?: string
	reasoningEffort?: string
	thinkingBudgetTokens?: number
	openRouterProviderSorting?: string
	openRouterModelId?: string
	openRouterModelInfo?: ModelInfo
	clineAccountId?: string
}

interface OpenRouterCompletionUsage extends CompletionUsage {
	cost_details?: {
		upstream_inference_cost?: number
	}
	cost?: number
}

interface OpenRouterCompletionChunkChoice extends Omit<ChatCompletionChunk.Choice, "finish_reason"> {
	// Extends the original list of finish_reason to includes choice?.finish_reason === "error"
	finish_reason: "error" | ChatCompletionChunk.Choice["finish_reason"]
}

export class ClineHandler implements ApiHandler {
	private readonly options: ClineHandlerOptions
	private readonly clineAccountService = ClineAccountService.getInstance()
	private readonly authService = AuthService.getInstance()
	private readonly baseUrl = clineEnvConfig.apiBaseUrl
	private client?: OpenAI
	lastGenerationId?: string

	constructor(options: ClineHandlerOptions) {
		this.options = options
	}

	private async getClient(): Promise<OpenAI> {
		const apiKey = await this.authService.getAuthToken()
		if (!apiKey) {
			throw new Error(CLINE_ACCOUNT_AUTH_ERROR_MESSAGE)
		}

		if (!this.client) {
			this.client = new OpenAI({
				baseURL: `${this.baseUrl}/api/v1`,
				apiKey,
				defaultHeaders: {
					"HTTP-Referer": "https://cline.bot",
					"X-Title": "Cline",
					"X-Task-ID": this.options.taskId || "",
					"X-Cline-Version": extensionVersion,
				},
			})
		} else {
			this.client.apiKey = apiKey
		}

		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const client = await this.getClient()
		this.lastGenerationId = undefined

		let usageEmitted = false
		const stream = await createOpenRouterStream(
			client,
			systemPrompt,
			messages,
			this.getModel(),
			this.options.reasoningEffort,
			this.options.thinkingBudgetTokens,
			this.options.openRouterProviderSorting,
		)

		for await (const chunk of stream) {
			if ("error" in chunk) {
				// Returns error from OpenRouter as-is.
				throw chunk.error
			}

			if (chunk.id && !this.lastGenerationId) {
				this.lastGenerationId = chunk.id
			}

			const choice = chunk.choices?.[0] as OpenRouterCompletionChunkChoice
			if (choice?.finish_reason === "error" && "error" in choice && choice.error) {
				// Returns error from OpenRouter as-is.
				throw choice.error
			}

			const delta = choice?.delta
			if (delta?.content) {
				yield { type: "text", text: delta.content }
			}
			if (
				"reasoning" in delta &&
				typeof delta.reasoning === "string" &&
				!shouldSkipReasoningForModel(this.options.openRouterModelId)
			) {
				yield {
					type: "reasoning",
					reasoning: delta.reasoning,
				}
			}

			if (!usageEmitted && chunk.usage) {
				const usage = chunk.usage as OpenRouterCompletionUsage
				const cachedTokens = usage.prompt_tokens_details?.cached_tokens || 0

				yield {
					type: "usage",
					cacheWriteTokens: 0,
					cacheReadTokens: cachedTokens,
					inputTokens: (usage.prompt_tokens || 0) - cachedTokens,
					outputTokens: usage.completion_tokens || 0,
					totalCost: (usage.cost || 0) + (usage.cost_details?.upstream_inference_cost || 0),
				}

				usageEmitted = true
			}
		}

		if (!usageEmitted) {
			const fallbackUsage = await this.getApiStreamUsage()
			if (fallbackUsage) {
				yield fallbackUsage
			}
		}
	}

	async getApiStreamUsage(): Promise<ApiStreamUsageChunk | undefined> {
		if (!this.lastGenerationId) {
			return undefined
		}

		const response = await axios.get(`${this.clineAccountService.baseUrl}/generation?id=${this.lastGenerationId}`, {
			headers: { Authorization: `Bearer ${this.options.clineAccountId}` },
			timeout: 15000,
		})

		const { native_tokens_cached, native_tokens_prompt, native_tokens_completion, total_cost } = response.data

		if (!native_tokens_prompt && !native_tokens_cached) {
			throw new Error("Cline API Error: No usage data returned")
		}

		return {
			type: "usage",
			cacheWriteTokens: 0,
			cacheReadTokens: native_tokens_cached || 0,
			inputTokens: (native_tokens_prompt || 0) - (native_tokens_cached || 0),
			outputTokens: native_tokens_completion || 0,
			totalCost: total_cost || 0,
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		const { openRouterModelId, openRouterModelInfo } = this.options

		if (openRouterModelId && openRouterModelInfo) {
			return { id: openRouterModelId, info: openRouterModelInfo }
		}

		return { id: openRouterDefaultModelId, info: openRouterDefaultModelInfo }
	}
}
