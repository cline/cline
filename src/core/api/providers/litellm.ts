import { Anthropic } from "@anthropic-ai/sdk"
import { LiteLLMModelInfo, liteLlmDefaultModelId, liteLlmModelInfoSaneDefaults } from "@shared/api"
import OpenAI from "openai"
import { ApiHandler, CommonApiHandlerOptions } from ".."
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

interface LiteLlmHandlerOptions extends CommonApiHandlerOptions {
	liteLlmApiKey?: string
	liteLlmBaseUrl?: string
	liteLlmModelId?: string
	liteLlmModelInfo?: LiteLLMModelInfo
	thinkingBudgetTokens?: number
	liteLlmUsePromptCache?: boolean
	ulid?: string
}

export interface LiteLlmModelInfoResponse {
	data: Array<{
		model_name: string
		litellm_params: {
			model: string
			[key: string]: any
		}
		model_info: {
			input_cost_per_token: number
			output_cost_per_token: number
			cache_creation_input_token_cost?: number
			cache_read_input_token_cost?: number
			supports_prompt_caching?: boolean
			[key: string]: any
		}
	}>
}

export class LiteLlmHandler implements ApiHandler {
	private options: LiteLlmHandlerOptions
	private client: OpenAI | undefined
	private modelInfoCache: LiteLlmModelInfoResponse | undefined
	private modelInfoCacheTimestamp: number = 0
	private readonly modelInfoCacheTTL = 5 * 60 * 1000 // 5 minutes

	constructor(options: LiteLlmHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.liteLlmApiKey) {
				throw new Error("LiteLLM API key is required")
			}
			try {
				this.client = new OpenAI({
					baseURL: this.options.liteLlmBaseUrl || "http://localhost:4000",
					apiKey: this.options.liteLlmApiKey || "noop",
				})
			} catch (error) {
				throw new Error(`Error creating LiteLLM client: ${error.message}`)
			}
		}
		return this.client
	}

	private async modelInfo(publicModelName: string): Promise<LiteLlmModelInfoResponse["data"][number] | undefined> {
		const modelInfo = await this.fetchModelsInfo()

		if (!modelInfo?.data) {
			return undefined
		}

		return modelInfo.data.find((model) => model.model_name === publicModelName)
	}

	private async fetchModelsInfo(): Promise<LiteLlmModelInfoResponse | undefined> {
		// Check if cache is still valid
		const now = Date.now()
		if (this.modelInfoCache && now - this.modelInfoCacheTimestamp < this.modelInfoCacheTTL) {
			return this.modelInfoCache
		}

		const client = this.ensureClient()
		// Handle base URLs that already include /v1 to avoid double /v1/v1/
		const baseUrl = client.baseURL.endsWith("/v1") ? client.baseURL : `${client.baseURL}/v1`
		const url = `${baseUrl}/model/info`

		try {
			const response = await fetch(url, {
				method: "GET",
				headers: {
					accept: "application/json",
					"x-litellm-api-key": this.options.liteLlmApiKey || "",
				},
			})

			if (response.ok) {
				const data: LiteLlmModelInfoResponse = await response.json()
				this.modelInfoCache = data
				this.modelInfoCacheTimestamp = now
				return data
			} else {
				console.warn("Failed to fetch LiteLLM model info:", response.statusText)
				// Try with Authorization header instead
				const retryResponse = await fetch(url, {
					method: "GET",
					headers: {
						accept: "application/json",
						Authorization: `Bearer ${this.options.liteLlmApiKey || ""}`,
					},
				})

				if (retryResponse.ok) {
					const data: LiteLlmModelInfoResponse = await retryResponse.json()
					this.modelInfoCache = data
					this.modelInfoCacheTimestamp = now
					return data
				} else {
					console.warn("Failed to fetch LiteLLM model info with Authorization header:", retryResponse.statusText)
					return undefined
				}
			}
		} catch (error) {
			console.warn("Error fetching LiteLLM model info:", error)
			return undefined
		}
	}

	private async getModelCostInfo(publicModelName: string): Promise<{
		inputCostPerToken: number
		outputCostPerToken: number
		cacheCreationCostPerToken?: number
		cacheReadCostPerToken?: number
	}> {
		try {
			const matchingModel = await this.modelInfo(publicModelName)

			if (matchingModel) {
				return {
					inputCostPerToken: matchingModel.model_info.input_cost_per_token || 0,
					outputCostPerToken: matchingModel.model_info.output_cost_per_token || 0,
					cacheCreationCostPerToken: matchingModel.model_info.cache_creation_input_token_cost,
					cacheReadCostPerToken: matchingModel.model_info.cache_read_input_token_cost,
				}
			}
		} catch (error) {
			console.warn("Error getting LiteLLM model cost info:", error)
		}

		// Fallback to zero costs if we can't get the information
		return {
			inputCostPerToken: 0,
			outputCostPerToken: 0,
		}
	}

	async calculateCost(
		prompt_tokens: number,
		completion_tokens: number,
		cache_creation_tokens?: number,
		cache_read_tokens?: number,
	): Promise<number | undefined> {
		const publicModelId = this.options.liteLlmModelId || liteLlmDefaultModelId

		try {
			const costInfo = await this.getModelCostInfo(publicModelId)

			// Calculate costs for different token types
			const inputCost = Math.max(0, prompt_tokens - (cache_read_tokens || 0)) * costInfo.inputCostPerToken
			const outputCost = completion_tokens * costInfo.outputCostPerToken
			const cacheCreationCost = (cache_creation_tokens || 0) * (costInfo.cacheCreationCostPerToken || 0)
			const cacheReadCost = (cache_read_tokens || 0) * (costInfo.cacheReadCostPerToken || 0)

			const totalCost = inputCost + outputCost + cacheCreationCost + cacheReadCost

			return totalCost
		} catch (error) {
			console.error("Error calculating spend:", error)
			return undefined
		}
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const client = this.ensureClient()
		const formattedMessages = convertToOpenAiMessages(messages)
		const systemMessage: OpenAI.Chat.ChatCompletionSystemMessageParam | Anthropic.Messages.TextBlockParam = {
			role: "system",
			content: systemPrompt,
		}
		const modelId = this.options.liteLlmModelId || liteLlmDefaultModelId
		const isOminiModel = modelId.includes("o1-mini") || modelId.includes("o3-mini") || modelId.includes("o4-mini")

		// Configuration for extended thinking
		const budgetTokens = this.options.thinkingBudgetTokens || 0
		const reasoningOn = budgetTokens !== 0
		const thinkingConfig = reasoningOn ? { type: "enabled", budget_tokens: budgetTokens } : undefined

		let temperature: number | undefined = this.options.liteLlmModelInfo?.temperature ?? 0

		if (isOminiModel && reasoningOn) {
			temperature = undefined // Thinking mode doesn't support temperature
		}

		const modelInfo = await this.modelInfo(modelId)
		const cacheControl =
			this.options.liteLlmUsePromptCache && Boolean(modelInfo?.model_info.supports_prompt_caching)
				? { cache_control: { type: "ephemeral" } }
				: undefined

		if (cacheControl) {
			// Add cache_control to system message if enabled
			// https://docs.litellm.ai/docs/providers/anthropic#caching---large-context-caching
			systemMessage.content = [
				{
					text: systemPrompt,
					type: "text",
					...cacheControl,
				},
			] as Anthropic.Messages.TextBlockParam[]
		}

		// Find the last two user messages to apply caching
		const userMsgIndices = formattedMessages.reduce(
			(acc, msg, index) => (msg.role === "user" ? [...acc, index] : acc),
			[] as number[],
		)
		const lastUserMsgIndex = userMsgIndices[userMsgIndices.length - 1] ?? -1
		const secondLastUserMsgIndex = userMsgIndices[userMsgIndices.length - 2] ?? -1

		// Apply cache_control to the last two user messages if enabled
		// https://docs.litellm.ai/docs/providers/anthropic#caching---large-context-caching
		const enhancedMessages: OpenAI.Chat.ChatCompletionMessageParam[] = formattedMessages.map(
			(message, index): OpenAI.Chat.ChatCompletionMessageParam => {
				if ((index === lastUserMsgIndex || index === secondLastUserMsgIndex) && cacheControl) {
					// Handle both string and array content types
					if (typeof message.content === "string") {
						return {
							...message,
							content: [
								{
									type: "text",
									text: message.content,
									...cacheControl,
								},
							] as any,
						}
					} else if (Array.isArray(message.content)) {
						// Apply cache control to the last content item in the array
						return {
							...message,
							content: message.content.map((item, contentIndex) =>
								contentIndex === (message.content?.length || 0) - 1
									? {
											...item,
											...cacheControl,
										}
									: item,
							) as any,
						}
					}

					return {
						...message,
						...cacheControl,
					}
				}
				return message
			},
		)

		const stream = await client.chat.completions.create({
			model: this.options.liteLlmModelId || liteLlmDefaultModelId,
			messages: [systemMessage, ...enhancedMessages],
			temperature,
			stream: true,
			stream_options: { include_usage: true },
			...(thinkingConfig && { thinking: thinkingConfig }), // Add thinking configuration when applicable
			...(this.options.ulid && { litellm_session_id: `cline-${this.options.ulid}` }), // Add session ID for LiteLLM tracking
		})

		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta

			// Handle normal text content
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			// Handle reasoning events
			// This is not in the standard types but may be in the response
			interface ThinkingDelta {
				reasoning_content?: string
			}

			if ((delta as ThinkingDelta)?.reasoning_content) {
				yield {
					type: "reasoning",
					reasoning: (delta as ThinkingDelta).reasoning_content || "",
				}
			}

			// Handle token usage information
			if (chunk.usage) {
				// Extract cache-related information if available
				// Need to use type assertion since these properties are not in the standard OpenAI types
				const usage = chunk.usage as {
					prompt_tokens: number
					completion_tokens: number
					cache_creation_input_tokens?: number
					prompt_cache_miss_tokens?: number
					cache_read_input_tokens?: number
					prompt_cache_hit_tokens?: number
				}

				const cacheWriteTokens = usage.cache_creation_input_tokens || usage.prompt_cache_miss_tokens || 0
				const cacheReadTokens = usage.cache_read_input_tokens || usage.prompt_cache_hit_tokens || 0

				// Calculate cost using the actual token usage including cache tokens
				const totalCost =
					(await this.calculateCost(
						usage.prompt_tokens || 0,
						usage.completion_tokens || 0,
						cacheWriteTokens > 0 ? cacheWriteTokens : undefined,
						cacheReadTokens > 0 ? cacheReadTokens : undefined,
					)) || 0

				yield {
					type: "usage",
					inputTokens: usage.prompt_tokens || 0,
					outputTokens: usage.completion_tokens || 0,
					cacheWriteTokens: cacheWriteTokens > 0 ? cacheWriteTokens : undefined,
					cacheReadTokens: cacheReadTokens > 0 ? cacheReadTokens : undefined,
					totalCost,
				}
			}
		}
	}

	getModel() {
		return {
			id: this.options.liteLlmModelId || liteLlmDefaultModelId,
			info: this.options.liteLlmModelInfo || liteLlmModelInfoSaneDefaults,
		}
	}
}
