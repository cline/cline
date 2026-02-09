import { ModelInfo, openRouterDefaultModelId, openRouterDefaultModelInfo } from "@shared/api"
import { shouldSkipReasoningForModel } from "@utils/model-utils"
import axios from "axios"
import OpenAI from "openai"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import { BeadsmithEnv } from "@/config"
import { BeadsmithAccountService } from "@/services/account/BeadsmithAccountService"
import { AuthService } from "@/services/auth/AuthService"
import { buildBeadsmithExtraHeaders } from "@/services/EnvUtils"
import { BEADSMITH_ACCOUNT_AUTH_ERROR_MESSAGE } from "@/shared/BeadsmithAccount"
import { BeadsmithStorageMessage } from "@/shared/messages/content"
import { fetch, getAxiosSettings } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import { ApiHandler, CommonApiHandlerOptions } from "../"
import { withRetry } from "../retry"
import { createOpenRouterStream } from "../transform/openrouter-stream"
import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { ToolCallProcessor } from "../transform/tool-call-processor"
import { OpenRouterErrorResponse } from "./types"

interface BeadsmithHandlerOptions extends CommonApiHandlerOptions {
	ulid?: string
	taskId?: string
	reasoningEffort?: string
	thinkingBudgetTokens?: number
	openRouterProviderSorting?: string
	openRouterModelId?: string
	openRouterModelInfo?: ModelInfo
	beadsmithAccountId?: string
	geminiThinkingLevel?: string
}

export class BeadsmithHandler implements ApiHandler {
	private options: BeadsmithHandlerOptions
	private beadsmithAccountService = BeadsmithAccountService.getInstance()
	private _authService: AuthService
	private client: OpenAI | undefined
	lastGenerationId?: string
	private lastRequestId?: string

	private get _baseUrl(): string {
		return BeadsmithEnv.config().apiBaseUrl
	}

	constructor(options: BeadsmithHandlerOptions) {
		this.options = options
		this._authService = AuthService.getInstance()
	}

	private async ensureClient(): Promise<OpenAI> {
		const beadsmithAccountAuthToken = await this._authService.getAuthToken()
		if (!beadsmithAccountAuthToken) {
			throw new Error(BEADSMITH_ACCOUNT_AUTH_ERROR_MESSAGE)
		}
		if (!this.client) {
			try {
				const defaultHeaders: Record<string, string> = {
					"HTTP-Referer": "https://cline.bot",
					"X-Title": "Beadsmith",
					"X-Task-ID": this.options.ulid || "",
				}
				Object.assign(defaultHeaders, await buildBeadsmithExtraHeaders())

				this.client = new OpenAI({
					baseURL: `${this._baseUrl}/api/v1`,
					apiKey: beadsmithAccountAuthToken,
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
				throw new Error(`Error creating Beadsmith client: ${error.message}`)
			}
		}
		// Ensure the client is always using the latest auth token
		this.client.apiKey = beadsmithAccountAuthToken
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: BeadsmithStorageMessage[], tools?: OpenAITool[]): ApiStream {
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
				Logger.debug("BeadsmithHandler chunk:" + JSON.stringify(chunk))
				// openrouter returns an error object instead of the openai sdk throwing an error
				if ("error" in chunk) {
					const error = chunk.error as OpenRouterErrorResponse["error"]
					Logger.error(`Beadsmith API Error: ${error?.code} - ${error?.message}`)
					// Include metadata in the error message if available
					const metadataStr = error.metadata ? `\nMetadata: ${JSON.stringify(error.metadata, null, 2)}` : ""
					throw new Error(`Beadsmith API Error ${error.code}: ${error.message}${metadataStr}`)
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
						Logger.error(`Beadsmith Mid-Stream Error: ${error.code || error.type || "Unknown"} - ${error.message}`)
						throw new Error(`Beadsmith Mid-Stream Error: ${error.code || error.type || "Unknown"} - ${error.message}`)
					} else {
						throw new Error(
							"Beadsmith Mid-Stream Error: Stream terminated with error status but no error details provided",
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

					if (["kwaipilot/kat-coder-pro"].includes(this.getModel().id)) {
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
				Logger.warn("Beadsmith API did not return usage chunk, fetching from generation endpoint")
				const apiStreamUsage = await this.getApiStreamUsage()
				if (apiStreamUsage) {
					yield apiStreamUsage
				}
			}
		} catch (error) {
			Logger.error("Beadsmith API Error:", error)
			throw error
		}
	}

	async getApiStreamUsage(): Promise<ApiStreamUsageChunk | undefined> {
		if (this.lastGenerationId) {
			try {
				const beadsmithAccountAuthToken = await this._authService.getAuthToken()
				if (!beadsmithAccountAuthToken) {
					throw new Error(BEADSMITH_ACCOUNT_AUTH_ERROR_MESSAGE)
				}
				const headers: Record<string, string> = {
					// Align with backend auth expectations
					Authorization: `Bearer ${beadsmithAccountAuthToken}`,
				}
				Object.assign(headers, await buildBeadsmithExtraHeaders())

				const response = await axios.get(
					`${this.beadsmithAccountService.baseUrl}/generation?id=${this.lastGenerationId}`,
					{
						headers,
						timeout: 15_000, // this request hangs sometimes
						...getAxiosSettings(),
					},
				)

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
				Logger.error("Error fetching beadsmith generation details:", error)
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
