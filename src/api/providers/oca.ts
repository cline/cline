import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { liteLlmDefaultModelId, liteLlmModelInfoSaneDefaults, LiteLLMModelInfo } from "@shared/api"
import { ApiHandler } from ".."
import { ApiStream } from "../transform/stream"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { withRetry } from "../retry"
import { DEFAULT_OCA_BASE_URL } from "@/core/controller/oca/util/constants"
import { OcaTokenManager } from "@/core/controller/oca/util/ocaTokenManager"
import { createOcaHeaders } from "@/core/controller/oca/util/utils"
import { Logger } from "@/services/logging/Logger"

export interface OcaHandlerOptions {
	ocaApiKey?: string
	ocaBaseUrl?: string
	ocaModelId?: string
	ocaModelInfo?: LiteLLMModelInfo
	thinkingBudgetTokens?: number
	ocaUsePromptCache?: boolean
	taskId?: string
}

export class OcaHandler implements ApiHandler {
	protected options: OcaHandlerOptions
	protected client: OpenAI | undefined

	constructor(options: OcaHandlerOptions) {
		this.options = options
		this.client = this.initializeClient(options)
	}

	protected initializeClient(options: OcaHandlerOptions) {
		return new OpenAI({
			baseURL: options.ocaBaseUrl || DEFAULT_OCA_BASE_URL,
			apiKey: "noop",
			fetch: async (url, init) => {
				try {
					// Authorization Header
					const token = (await OcaTokenManager.getToken()).access_token
					if (!token) {
						throw new Error("Oracle Code Assist (OCA) access token is not available")
					}

					const globalFetch = (typeof fetch === "function" ? fetch : globalThis.fetch).bind(undefined)

					// OCA Headers
					const headersRecord = await createOcaHeaders(token, this.options.taskId!)
					const headers = new Headers()
					for (const [key, value] of Object.entries(headersRecord)) {
						headers.append(key, value)
					}
					Logger.log(`Making request with customer opc-request-id: ${headers.get("opc-request-id")}`)

					return await globalFetch(url, {
						...init,
						headers,
					})
				} catch (e) {
					console.error("Fetch failed:", e)
					throw e
				}
			},
		})
	}

	protected ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.ocaApiKey) {
				throw new Error("Oracle Code Assist (OCA) access token is not available")
			}
			if (!this.options.ocaModelId) {
				throw new Error("Oracle Code Assist (OCA) model is not selected")
			}
			try {
				this.client = this.initializeClient(this.options)
			} catch (error) {
				throw new Error(`Error creating Oracle Code Assist (OCA) client: ${error.message}`)
			}
		}
		return this.client
	}

	async calculateCost(prompt_tokens: number, completion_tokens: number): Promise<number | undefined> {
		// Reference: https://github.com/BerriAI/litellm/blob/122ee634f434014267af104814022af1d9a0882f/litellm/proxy/spend_tracking/spend_management_endpoints.py#L1473
		const client = this.ensureClient()
		const modelId = this.options.ocaModelId || liteLlmDefaultModelId
		try {
			const response = await fetch(`${client.baseURL}/spend/calculate`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.options.ocaApiKey}`,
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

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const client = this.ensureClient()
		const formattedMessages = convertToOpenAiMessages(messages)
		const systemMessage: OpenAI.Chat.ChatCompletionSystemMessageParam = {
			role: "system",
			content: systemPrompt,
		}
		const modelId = this.options.ocaModelId || liteLlmDefaultModelId
		const isOminiModel = modelId.includes("o1-mini") || modelId.includes("o3-mini") || modelId.includes("o4-mini")

		// Configuration for extended thinking
		const budgetTokens = this.options.thinkingBudgetTokens || 0
		const reasoningOn = budgetTokens !== 0 ? true : false
		const thinkingConfig = reasoningOn ? { type: "enabled", budget_tokens: budgetTokens } : undefined

		let temperature: number | undefined = this.options.ocaModelInfo?.temperature ?? 0
		let maxTokens: number | undefined = this.options.ocaModelInfo?.maxTokens

		if (isOminiModel && reasoningOn) {
			temperature = undefined // Thinking mode doesn't support temperature
		}

		// Define cache control object if prompt caching is enabled
		const cacheControl = this.options.ocaUsePromptCache ? { cache_control: { type: "ephemeral" } } : undefined

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

		const stream = await client.chat.completions.create({
			model: this.options.ocaModelId || liteLlmDefaultModelId,
			messages: [enhancedSystemMessage, ...enhancedMessages],
			temperature,
			stream: true,
			max_completion_tokens: maxTokens,
			max_tokens: maxTokens,
			stream_options: { include_usage: true },
			...(thinkingConfig && { thinking: thinkingConfig }), // Add thinking configuration when applicable
			...(this.options.taskId && { litellm_session_id: `cline-${this.options.taskId}` }), // Add session ID for LiteLLM tracking
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
				}
			}
		}
	}

	getModel() {
		return {
			id: this.options.ocaModelId || liteLlmDefaultModelId,
			info: this.options.ocaModelInfo || liteLlmModelInfoSaneDefaults,
		}
	}
}
