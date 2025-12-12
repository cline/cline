import { ModelInfo, openRouterDefaultModelId, openRouterDefaultModelInfo } from "@shared/api"
import { shouldSkipReasoningForModel } from "@utils/model-utils"
import axios from "axios"
import OpenAI from "openai"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import { ClineEnv } from "@/config"
import { ClineAccountService } from "@/services/account/ClineAccountService"
import { AuthService } from "@/services/auth/AuthService"
import { buildClineExtraHeaders } from "@/services/EnvUtils"
import { Logger } from "@/services/logging/Logger"
import { CLINE_ACCOUNT_AUTH_ERROR_MESSAGE } from "@/shared/ClineAccount"
import { ClineStorageMessage } from "@/shared/messages/content"
import { fetch, getAxiosSettings } from "@/shared/net"
import { ApiHandler, CommonApiHandlerOptions } from "../"
import { withRetry } from "../retry"
import { createOpenRouterStream } from "../transform/openrouter-stream"
import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { ToolCallProcessor } from "../transform/tool-call-processor"
import { OpenRouterErrorResponse } from "./types"

interface ClineHandlerOptions extends CommonApiHandlerOptions {
	ulid?: string
	taskId?: string
	reasoningEffort?: string
	thinkingBudgetTokens?: number
	openRouterProviderSorting?: string
	openRouterModelId?: string
	openRouterModelInfo?: ModelInfo
	clineAccountId?: string
	geminiThinkingLevel?: string
}

export class ClineHandler implements ApiHandler {
	private options: ClineHandlerOptions
	private clineAccountService = ClineAccountService.getInstance()
	private _authService: AuthService
	private client: OpenAI | undefined
	private readonly _baseUrl = ClineEnv.config().apiBaseUrl
	lastGenerationId?: string
	private lastRequestId?: string

	constructor(options: ClineHandlerOptions) {
		this.options = options
		this._authService = AuthService.getInstance()
	}

	private async ensureClient(): Promise<OpenAI> {
		const clineAccountAuthToken = await this._authService.getAuthToken()
		if (!clineAccountAuthToken) {
			throw new Error(CLINE_ACCOUNT_AUTH_ERROR_MESSAGE)
		}
		if (!this.client) {
			try {
				const defaultHeaders: Record<string, string> = {
					"HTTP-Referer": "https://cline.bot",
					"X-Title": "Cline",
					"X-Task-ID": this.options.ulid || "",
				}
				Object.assign(defaultHeaders, await buildClineExtraHeaders())

				this.client = new OpenAI({
					baseURL: `${this._baseUrl}/api/v1`,
					apiKey: clineAccountAuthToken,
					defaultHeaders,
					// Capture real HTTP request ID from initial streaming response headers
					fetch: async (...args: Parameters<typeof fetch>): Promise<Awaited<ReturnType<typeof fetch>>> => {
						const [input, init] = args
						const resp = await fetch(input, init)
						try {
							let urlStr = ""
							if (typeof input === "string") {
								urlStr = input
							} else if (input instanceof URL) {
								urlStr = input.toString()
							} else if (typeof (input as { url?: unknown }).url === "string") {
								urlStr = (input as { url: string }).url
							}
							// Only record for chat completions (the primary streaming request)
							if (urlStr.includes("/chat/completions")) {
								const rid = resp.headers.get("x-request-id") || resp.headers.get("request-id")
								if (rid) {
									this.lastRequestId = rid
								}
							}
						} catch {
							// ignore header capture errors
						}
						return resp
					},
				})
			} catch (error: any) {
				throw new Error(`Error creating Cline client: ${error.message}`)
			}
		}
		// Ensure the client is always using the latest auth token
		this.client.apiKey = clineAccountAuthToken
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: OpenAITool[]): ApiStream {
		try {
			const client = await this.ensureClient()

			this.lastGenerationId = undefined
			this.lastRequestId = undefined

			let didOutputUsage: boolean = false

			const stream = await createOpenRouterStream(
				client,
				systemPrompt,
				messages,
				this.getModel(),
				this.options.reasoningEffort,
				this.options.thinkingBudgetTokens,
				this.options.openRouterProviderSorting,
				tools,
				this.options.geminiThinkingLevel,
			)

			const toolCallProcessor = new ToolCallProcessor()

			for await (const chunk of stream) {
				Logger.debug("ClineHandler chunk:" + JSON.stringify(chunk))
				// openrouter returns an error object instead of the openai sdk throwing an error
				if ("error" in chunk) {
					const error = chunk.error as OpenRouterErrorResponse["error"]
					console.error(`Cline API Error: ${error?.code} - ${error?.message}`)
					// Include metadata in the error message if available
					const metadataStr = error.metadata ? `\nMetadata: ${JSON.stringify(error.metadata, null, 2)}` : ""
					throw new Error(`Cline API Error ${error.code}: ${error.message}${metadataStr}`)
				}

				if (!this.lastGenerationId && chunk.id) {
					this.lastGenerationId = chunk.id
				}

				// Check for mid-stream error via finish_reason
				const choice = chunk.choices?.[0]
				// OpenRouter may return finish_reason = "error" with error details
				if ((choice?.finish_reason as string) === "error") {
					const choiceWithError = choice as any
					if (choiceWithError.error) {
						const error = choiceWithError.error
						console.error(`Cline Mid-Stream Error: ${error.code || error.type || "Unknown"} - ${error.message}`)
						throw new Error(`Cline Mid-Stream Error: ${error.code || error.type || "Unknown"} - ${error.message}`)
					} else {
						throw new Error(
							"Cline Mid-Stream Error: Stream terminated with error status but no error details provided",
						)
					}
				}

				const delta = choice?.delta

				if (delta?.content) {
					yield {
						type: "text",
						text: delta.content,
					}
				}

				if (delta?.tool_calls) {
					yield* toolCallProcessor.processToolCallDeltas(delta.tool_calls)
				}

				// Reasoning tokens are returned separately from the content
				// Skip reasoning content for Grok 4 models since it only displays "thinking" without providing useful information
				if ("reasoning" in delta && delta.reasoning && !shouldSkipReasoningForModel(this.options.openRouterModelId)) {
					yield {
						type: "reasoning",
						reasoning: typeof delta.reasoning === "string" ? delta.reasoning : JSON.stringify(delta.reasoning),
					}
				}

				/* 
				OpenRouter passes reasoning details that we can pass back unmodified in api requests to preserve reasoning traces for model
				  - The reasoning_details array in each chunk may contain one or more reasoning objects
				  - For encrypted reasoning, the content may appear as [REDACTED] in streaming responses
				  - The complete reasoning sequence is built by concatenating all chunks in order
				See: https://openrouter.ai/docs/use-cases/reasoning-tokens#preserving-reasoning-blocks
				*/
				if (
					"reasoning_details" in delta &&
					delta.reasoning_details &&
					// @ts-ignore-next-line
					delta?.reasoning_details?.length && // exists and non-0
					!shouldSkipReasoningForModel(this.options.openRouterModelId)
				) {
					yield {
						type: "reasoning",
						reasoning: "",
						details: delta.reasoning_details,
					}
				}

				if (!didOutputUsage && chunk.usage) {
					// @ts-ignore-next-line
					let totalCost = (chunk.usage.cost || 0) + (chunk.usage.cost_details?.upstream_inference_cost || 0)

					if (["x-ai/grok-code-fast-1", "minimax/minimax-m2", "mistralai/devstral-2512"].includes(this.getModel().id)) {
						totalCost = 0
					}

					yield {
						type: "usage",
						cacheWriteTokens: 0,
						cacheReadTokens: chunk.usage.prompt_tokens_details?.cached_tokens || 0,
						inputTokens: (chunk.usage.prompt_tokens || 0) - (chunk.usage.prompt_tokens_details?.cached_tokens || 0),
						outputTokens: chunk.usage.completion_tokens || 0,
						totalCost,
					}
					didOutputUsage = true
				}
			}

			// Fallback to generation endpoint if usage chunk not returned
			if (!didOutputUsage) {
				console.warn("Cline API did not return usage chunk, fetching from generation endpoint")
				const apiStreamUsage = await this.getApiStreamUsage()
				if (apiStreamUsage) {
					yield apiStreamUsage
				}
			}
		} catch (error) {
			console.error("Cline API Error:", error)
			throw error
		}
	}

	async getApiStreamUsage(): Promise<ApiStreamUsageChunk | undefined> {
		if (this.lastGenerationId) {
			try {
				const clineAccountAuthToken = await this._authService.getAuthToken()
				if (!clineAccountAuthToken) {
					throw new Error(CLINE_ACCOUNT_AUTH_ERROR_MESSAGE)
				}
				const headers: Record<string, string> = {
					// Align with backend auth expectations
					Authorization: `Bearer ${clineAccountAuthToken}`,
				}
				Object.assign(headers, await buildClineExtraHeaders())

				const response = await axios.get(`${this.clineAccountService.baseUrl}/generation?id=${this.lastGenerationId}`, {
					headers,
					timeout: 15_000, // this request hangs sometimes
					...getAxiosSettings(),
				})

				const generation = response.data
				return {
					type: "usage",
					cacheWriteTokens: 0,
					cacheReadTokens: generation?.native_tokens_cached || 0,
					// openrouter generation endpoint fails often
					inputTokens: (generation?.native_tokens_prompt || 0) - (generation?.native_tokens_cached || 0),
					outputTokens: generation?.native_tokens_completion || 0,
					totalCost: generation?.total_cost || 0,
				}
			} catch (error) {
				// ignore if fails
				console.error("Error fetching cline generation details:", error)
			}
		}
		return undefined
	}

	// Expose the last HTTP request ID captured from response headers (X-Request-ID)
	getLastRequestId(): string | undefined {
		return this.lastRequestId
	}

	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.openRouterModelId
		const modelInfo = this.options.openRouterModelInfo
		if (modelId && modelInfo) {
			return { id: modelId, info: modelInfo }
		}
		return { id: openRouterDefaultModelId, info: openRouterDefaultModelInfo }
	}
}
