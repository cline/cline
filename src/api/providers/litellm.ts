import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { ApiHandlerOptions, ModelInfo, liteLlmDefaultModelId, liteLlmModelInfoSaneDefaults } from "../../shared/api"
import { ApiHandler } from ".."
import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { convertToOpenAiMessages } from "../transform/openai-format"

export class LiteLlmHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: OpenAI
	private modelInfo: ModelInfo

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new OpenAI({
			baseURL: this.options.liteLlmBaseUrl || "http://localhost:4000",
			apiKey: this.options.liteLlmApiKey || "noop",
		})

		// Initialize model info with defaults
		this.modelInfo = { ...liteLlmModelInfoSaneDefaults }

		// Fetch model info asynchronously
		this.fetchModelInfo()
			.then((info) => {
				if (info) {
					this.modelInfo = info
					// Force a refresh of the UI by triggering a usage update
					this.getApiStreamUsage()
				}
			})
			.catch((error) => {
				console.error("Failed to initialize model info:", error)
			})
	}

	private async fetchModelInfo(): Promise<ModelInfo | undefined> {
		try {
			const response = await fetch(`${this.client.baseURL}/model/info`, {
				method: "GET",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.options.liteLlmApiKey}`,
				},
			})

			if (response.ok) {
				const data = await response.json()
				// Find the model info for the current model
				const modelId = this.options.liteLlmModelId || liteLlmDefaultModelId
				const modelData = data.data.find((model: any) => model.model_name === modelId)

				if (modelData?.model_info) {
					// Extract relevant model information
					return {
						maxTokens: modelData.model_info.max_output_tokens || -1,
						contextWindow: modelData.model_info.max_input_tokens || 128_000,
						supportsImages: !!modelData.model_info.supports_images,
						supportsPromptCache: !!modelData.model_info.supports_prompt_cache || true,
						inputPrice: modelData.model_info.input_cost_per_token
							? modelData.model_info.input_cost_per_token * 1e6
							: 0,
						outputPrice: modelData.model_info.output_cost_per_token
							? modelData.model_info.output_cost_per_token * 1e6
							: 0,
						cacheWritesPrice: modelData.model_info.cache_writes_cost_per_token
							? modelData.model_info.cache_writes_cost_per_token * 1e6
							: 0,
						cacheReadsPrice: modelData.model_info.cache_reads_cost_per_token
							? modelData.model_info.cache_reads_cost_per_token * 1e6
							: 0,
					}
				}
			}

			console.error("Failed to fetch model info:", response.statusText)
			return undefined
		} catch (error) {
			console.error("Error fetching model info:", error)
			return undefined
		}
	}

	async calculateCost(prompt_tokens: number, completion_tokens: number): Promise<number | undefined> {
		// Reference: https://github.com/BerriAI/litellm/blob/122ee634f434014267af104814022af1d9a0882f/litellm/proxy/spend_tracking/spend_management_endpoints.py#L1473
		const modelId = this.options.liteLlmModelId || liteLlmDefaultModelId
		try {
			const response = await fetch(`${this.client.baseURL}/spend/calculate`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.options.liteLlmApiKey}`,
				},
				body: JSON.stringify({
					completion_response: {
						model: modelId,
						usage: {
							prompt_tokens,
							completion_tokens,
						},
					},
				}),
			})

			if (response.ok) {
				const data: { cost: number } = await response.json()
				return data.cost
			} else {
				console.error("Error calculating spend:", response.statusText)
				return undefined
			}
		} catch (error) {
			console.error("Error calculating spend:", error)
			return undefined
		}
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const formattedMessages = convertToOpenAiMessages(messages)
		const systemMessage: OpenAI.Chat.ChatCompletionSystemMessageParam = {
			role: "system",
			content: systemPrompt,
		}
		const modelId = this.options.liteLlmModelId || liteLlmDefaultModelId
		const isOminiModel = modelId.includes("o1-mini") || modelId.includes("o3-mini")

		// Configuration for extended thinking
		const budgetTokens = this.options.thinkingBudgetTokens || 0
		const reasoningOn = budgetTokens !== 0 ? true : false
		const thinkingConfig = reasoningOn ? { type: "enabled", budget_tokens: budgetTokens } : undefined

		let temperature: number | undefined = 0

		if (isOminiModel && reasoningOn) {
			temperature = undefined // Thinking mode doesn't support temperature
		}

		// Define cache control object if prompt caching is enabled
		const cacheControl = this.options.liteLlmUsePromptCache ? { cache_control: { type: "ephemeral" } } : undefined

		// Add cache_control to system message if enabled
		const enhancedSystemMessage = {
			...systemMessage,
			...(cacheControl && cacheControl),
		}

		// Find the last two user messages to apply caching
		const userMsgIndices = formattedMessages.reduce(
			(acc, msg, index) => (msg.role === "user" ? [...acc, index] : acc),
			[] as number[],
		)
		const lastUserMsgIndex = userMsgIndices[userMsgIndices.length - 1] ?? -1
		const secondLastUserMsgIndex = userMsgIndices[userMsgIndices.length - 2] ?? -1

		// Apply cache_control to the last two user messages if enabled
		const enhancedMessages = formattedMessages.map((message, index) => {
			if ((index === lastUserMsgIndex || index === secondLastUserMsgIndex) && cacheControl) {
				return {
					...message,
					...cacheControl,
				}
			}
			return message
		})

		const stream = await this.client.chat.completions.create({
			model: this.options.liteLlmModelId || liteLlmDefaultModelId,
			messages: [enhancedSystemMessage, ...enhancedMessages],
			temperature,
			stream: true,
			stream_options: { include_usage: true },
			...(thinkingConfig && { thinking: thinkingConfig }), // Add thinking configuration when applicable
		})

		const inputCost = (await this.calculateCost(1e6, 0)) || 0
		const outputCost = (await this.calculateCost(0, 1e6)) || 0

		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta

			// Handle normal text content
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			// Handle reasoning events (thinking)
			// Thinking is not in the standard types but may be in the response
			interface ThinkingDelta {
				thinking?: string
			}

			if ((delta as ThinkingDelta)?.thinking) {
				yield {
					type: "reasoning",
					reasoning: (delta as ThinkingDelta).thinking || "",
				}
			}

			// Handle token usage information
			if (chunk.usage) {
				const totalCost =
					(inputCost * chunk.usage.prompt_tokens) / 1e6 + (outputCost * chunk.usage.completion_tokens) / 1e6

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

				yield {
					type: "usage",
					inputTokens: usage.prompt_tokens || 0,
					outputTokens: usage.completion_tokens || 0,
					cacheWriteTokens: cacheWriteTokens > 0 ? cacheWriteTokens : undefined,
					cacheReadTokens: cacheReadTokens > 0 ? cacheReadTokens : undefined,
					totalCost,
					modelName: this.options.liteLlmModelId || liteLlmDefaultModelId,
				}
			}
		}
	}

	getModel() {
		return {
			id: this.options.liteLlmModelId || liteLlmDefaultModelId,
			info: this.modelInfo,
		}
	}

	async getApiStreamUsage(): Promise<ApiStreamUsageChunk | undefined> {
		try {
			const modelInfo = await this.fetchModelInfo()
			if (modelInfo) {
				this.modelInfo = modelInfo
				// Return a standard usage chunk to trigger UI update
				return {
					type: "usage",
					inputTokens: 0,
					outputTokens: 0,
					modelName: this.options.liteLlmModelId || liteLlmDefaultModelId,
				}
			}
			return undefined
		} catch (error) {
			console.error("Error getting API stream usage:", error)
			return undefined
		}
	}
}
