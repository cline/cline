import { ModelInfo, OpenAiCodexModelId, openAiCodexDefaultModelId, openAiCodexModels } from "@shared/api"
import OpenAI from "openai"
import type { ChatCompletionTool } from "openai/resources/chat/completions"
import * as os from "os"
import { v7 as uuidv7 } from "uuid"
import { openAiCodexOAuthManager } from "@/integrations/openai-codex/oauth"
import { buildExternalBasicHeaders } from "@/services/EnvUtils"
import { ClineStorageMessage } from "@/shared/messages/content"
import { fetch } from "@/shared/net"
import { ApiHandler, CommonApiHandlerOptions } from "../"
import { convertToOpenAIResponsesInput } from "../transform/openai-response-format"
import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"

/**
 * OpenAI Codex base URL for API requests
 * Routes to chatgpt.com/backend-api/codex
 */
const CODEX_API_BASE_URL = "https://chatgpt.com/backend-api/codex"

interface OpenAiCodexHandlerOptions extends CommonApiHandlerOptions {
	reasoningEffort?: string
	apiModelId?: string
}

/**
 * OpenAiCodexHandler - Uses OpenAI Responses API with OAuth authentication
 *
 * Key differences from OpenAiNativeHandler:
 * - Uses OAuth Bearer tokens instead of API keys
 * - Routes requests to Codex backend (chatgpt.com/backend-api/codex)
 * - Subscription-based pricing (no per-token costs)
 * - Limited model subset
 * - Custom headers for Codex backend
 */
export class OpenAiCodexHandler implements ApiHandler {
	private options: OpenAiCodexHandlerOptions
	private client?: OpenAI
	// Session ID for the Codex API (persists for the lifetime of the handler)
	private readonly sessionId: string
	// Abort controller for cancelling ongoing requests
	private abortController?: AbortController
	// Track tool call identity for streaming
	private pendingToolCallId: string | undefined
	private pendingToolCallName: string | undefined

	constructor(options: OpenAiCodexHandlerOptions) {
		this.options = options
		this.sessionId = uuidv7()
	}

	private normalizeUsage(usage: any, model: { id: string; info: ModelInfo }): ApiStreamUsageChunk | undefined {
		if (!usage) {
			return undefined
		}

		const inputDetails = usage.input_tokens_details ?? usage.prompt_tokens_details

		const hasCachedTokens = typeof inputDetails?.cached_tokens === "number"
		const hasCacheMissTokens = typeof inputDetails?.cache_miss_tokens === "number"
		const cachedFromDetails = hasCachedTokens ? inputDetails.cached_tokens : 0
		const missFromDetails = hasCacheMissTokens ? inputDetails.cache_miss_tokens : 0

		let totalInputTokens = usage.input_tokens ?? usage.prompt_tokens ?? 0
		if (totalInputTokens === 0 && inputDetails && (cachedFromDetails > 0 || missFromDetails > 0)) {
			totalInputTokens = cachedFromDetails + missFromDetails
		}

		const totalOutputTokens = usage.output_tokens ?? usage.completion_tokens ?? 0
		const cacheWriteTokens = usage.cache_creation_input_tokens ?? usage.cache_write_tokens ?? 0
		const cacheReadTokens =
			usage.cache_read_input_tokens ?? usage.cache_read_tokens ?? usage.cached_tokens ?? cachedFromDetails ?? 0

		const reasoningTokens =
			typeof usage.output_tokens_details?.reasoning_tokens === "number"
				? usage.output_tokens_details.reasoning_tokens
				: undefined

		// Subscription-based: no per-token costs
		const out: ApiStreamUsageChunk = {
			type: "usage",
			inputTokens: totalInputTokens,
			outputTokens: totalOutputTokens,
			cacheWriteTokens,
			cacheReadTokens,
			...(typeof reasoningTokens === "number" ? { reasoningTokens } : {}),
			totalCost: 0, // Subscription-based pricing
		}
		return out
	}

	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: ChatCompletionTool[]): ApiStream {
		const model = this.getModel()

		// Reset state for this request
		this.pendingToolCallId = undefined
		this.pendingToolCallName = undefined

		// Get access token from OAuth manager
		let accessToken = await openAiCodexOAuthManager.getAccessToken()
		if (!accessToken) {
			throw new Error("Not authenticated with OpenAI Codex. Please sign in using the OpenAI Codex OAuth flow in settings.")
		}

		// Format conversation for Responses API
		const formattedInput = convertToOpenAIResponsesInput(messages)

		// Build request body
		const requestBody = this.buildRequestBody(model, formattedInput, systemPrompt, tools)

		// Make the request with retry on auth failure
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				yield* this.executeRequest(requestBody, model, accessToken)
				return
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				const isAuthFailure = /unauthorized|invalid token|not authenticated|authentication|401/i.test(message)

				if (attempt === 0 && isAuthFailure) {
					// Force refresh the token for retry
					const refreshed = await openAiCodexOAuthManager.forceRefreshAccessToken()
					if (!refreshed) {
						throw new Error(
							"Not authenticated with OpenAI Codex. Please sign in using the OpenAI Codex OAuth flow in settings.",
						)
					}
					accessToken = refreshed
					continue
				}
				throw error
			}
		}
	}

	private buildRequestBody(
		model: { id: string; info: ModelInfo },
		formattedInput: any,
		systemPrompt: string,
		tools?: ChatCompletionTool[],
	): any {
		// Determine reasoning effort
		const reasoningEffort = this.options.reasoningEffort || "medium"

		const body: any = {
			model: model.id,
			input: formattedInput,
			stream: true,
			store: false,
			instructions: systemPrompt,
			include: ["reasoning.encrypted_content"],
			reasoning: {
				effort: reasoningEffort,
				summary: "auto",
			},
		}

		// Add tools if provided
		// Pass through strict value from tool (MCP/custom tools have strict: false, built-in tools default to true)
		if (tools && tools.length > 0) {
			body.tools = tools
				.filter((tool: any) => tool?.type === "function")
				.map((tool: any) => ({
					type: "function",
					name: tool.function.name,
					description: tool.function.description,
					parameters: tool.function.parameters,
					strict: tool.function.strict ?? true,
				}))
		}

		return body
	}

	private async *executeRequest(requestBody: any, model: { id: string; info: ModelInfo }, accessToken: string): ApiStream {
		// Create AbortController for cancellation
		this.abortController = new AbortController()

		try {
			// Get ChatGPT account ID for organization subscriptions
			const accountId = await openAiCodexOAuthManager.getAccountId()

			// Build Codex-specific headers
			const codexHeaders: Record<string, string> = {
				originator: "cline",
				session_id: this.sessionId,
				"User-Agent": `cline/${process.env.npm_package_version || "1.0.0"} (${os.platform()} ${os.release()}; ${os.arch()}) node/${process.version.slice(1)}`,
				...(accountId ? { "ChatGPT-Account-Id": accountId } : {}),
				...buildExternalBasicHeaders(),
			}

			// Try using OpenAI SDK first
			try {
				const client =
					this.client ??
					new OpenAI({
						apiKey: accessToken,
						baseURL: CODEX_API_BASE_URL,
						defaultHeaders: codexHeaders,
						fetch, // Use shared fetch for proxy support
					})

				const stream = (await (client as any).responses.create(requestBody, {
					signal: this.abortController.signal,
					headers: codexHeaders,
				})) as AsyncIterable<any>

				if (typeof (stream as any)?.[Symbol.asyncIterator] !== "function") {
					throw new Error("OpenAI SDK did not return an AsyncIterable")
				}

				for await (const event of stream) {
					if (this.abortController.signal.aborted) {
						break
					}

					for await (const outChunk of this.processEvent(event, model)) {
						yield outChunk
					}
				}
			} catch (_sdkErr) {
				// Fallback to manual SSE via fetch
				yield* this.makeCodexRequest(requestBody, model, accessToken)
			}
		} finally {
			this.abortController = undefined
		}
	}

	private async *makeCodexRequest(requestBody: any, model: { id: string; info: ModelInfo }, accessToken: string): ApiStream {
		const url = `${CODEX_API_BASE_URL}/responses`

		// Get ChatGPT account ID for organization subscriptions
		const accountId = await openAiCodexOAuthManager.getAccountId()

		// Build headers with required Codex-specific fields
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Authorization: `Bearer ${accessToken}`,
			originator: "cline",
			session_id: this.sessionId,
			"User-Agent": `cline/${process.env.npm_package_version || "1.0.0"} (${os.platform()} ${os.release()}; ${os.arch()}) node/${process.version.slice(1)}`,
		}

		// Add ChatGPT-Account-Id if available
		if (accountId) {
			headers["ChatGPT-Account-Id"] = accountId
		}

		try {
			const response = await fetch(url, {
				method: "POST",
				headers,
				body: JSON.stringify(requestBody),
				signal: this.abortController?.signal,
			})

			if (!response.ok) {
				const errorText = await response.text()
				let errorMessage = `Codex API request failed: ${response.status}`

				try {
					const errorJson = JSON.parse(errorText)
					if (errorJson.error?.message) {
						errorMessage = errorJson.error.message
					} else if (errorJson.message) {
						errorMessage = errorJson.message
					}
				} catch {
					if (errorText) {
						errorMessage += ` - ${errorText}`
					}
				}

				throw new Error(errorMessage)
			}

			if (!response.body) {
				throw new Error("No response body from Codex API")
			}

			yield* this.handleStreamResponse(response.body, model)
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`Codex API error: ${error.message}`)
			}
			throw new Error("Unexpected error connecting to Codex API")
		}
	}

	private async *handleStreamResponse(body: ReadableStream<Uint8Array>, model: { id: string; info: ModelInfo }): ApiStream {
		const reader = body.getReader()
		const decoder = new TextDecoder()
		let buffer = ""

		try {
			while (true) {
				if (this.abortController?.signal.aborted) {
					break
				}

				const { done, value } = await reader.read()
				if (done) {
					break
				}

				buffer += decoder.decode(value, { stream: true })
				const lines = buffer.split("\n")
				buffer = lines.pop() || ""

				for (const line of lines) {
					if (line.startsWith("data: ")) {
						const data = line.slice(6).trim()
						if (data === "[DONE]") {
							continue
						}

						try {
							const parsed = JSON.parse(data)

							for await (const outChunk of this.processEvent(parsed, model)) {
								yield outChunk
							}
						} catch (e) {
							if (!(e instanceof SyntaxError)) {
								throw e
							}
						}
					}
				}
			}
		} finally {
			reader.releaseLock()
		}
	}

	private async *processEvent(event: any, model: { id: string; info: ModelInfo }): ApiStream {
		// Handle text deltas
		if (event?.type === "response.text.delta" || event?.type === "response.output_text.delta") {
			if (event?.delta) {
				yield { type: "text", text: event.delta }
			}
			return
		}

		// Handle reasoning deltas
		if (
			event?.type === "response.reasoning.delta" ||
			event?.type === "response.reasoning_text.delta" ||
			event?.type === "response.reasoning_summary.delta" ||
			event?.type === "response.reasoning_summary_text.delta"
		) {
			if (event?.delta) {
				yield { type: "reasoning", reasoning: event.delta }
			}
			return
		}

		// Handle refusal deltas
		if (event?.type === "response.refusal.delta") {
			if (event?.delta) {
				yield { type: "text", text: `[Refusal] ${event.delta}` }
			}
			return
		}

		// Handle tool/function call deltas
		if (event?.type === "response.tool_call_arguments.delta" || event?.type === "response.function_call_arguments.delta") {
			const callId = event.call_id || event.tool_call_id || event.id || this.pendingToolCallId
			const name = event.name || event.function_name || this.pendingToolCallName
			const args = event.delta || event.arguments

			if (typeof callId === "string" && callId.length > 0 && typeof name === "string" && name.length > 0) {
				yield {
					type: "tool_calls",
					tool_call: {
						call_id: callId,
						function: {
							id: callId,
							name,
							arguments: typeof args === "string" ? args : "",
						},
					},
				}
			}
			return
		}

		// Handle output item events
		if (event?.type === "response.output_item.added" || event?.type === "response.output_item.done") {
			const item = event?.item
			if (item) {
				// Capture tool identity for subsequent argument deltas
				if (item.type === "function_call" || item.type === "tool_call") {
					const callId = item.call_id || item.tool_call_id || item.id
					const name = item.name || item.function?.name || item.function_name
					if (typeof callId === "string" && callId.length > 0) {
						this.pendingToolCallId = callId
						this.pendingToolCallName = typeof name === "string" ? name : undefined
					}
				}

				if (item.type === "text" && item.text) {
					yield { type: "text", text: item.text }
				} else if (item.type === "reasoning" && item.text) {
					yield { type: "reasoning", reasoning: item.text }
				} else if (item.type === "message" && Array.isArray(item.content)) {
					for (const content of item.content) {
						if ((content?.type === "text" || content?.type === "output_text") && content?.text) {
							yield { type: "text", text: content.text }
						}
					}
				} else if (
					(item.type === "function_call" || item.type === "tool_call") &&
					event.type === "response.output_item.done"
				) {
					const callId = item.call_id || item.tool_call_id || item.id
					if (callId) {
						const args = item.arguments || item.function?.arguments || item.function_arguments
						yield {
							type: "tool_calls",
							id: callId,
							tool_call: {
								call_id: callId,
								function: {
									id: callId,
									name: item.name || item.function?.name || item.function_name || "",
									arguments: typeof args === "string" ? args : "{}",
								},
							},
						}
					}
				}
			}
			return
		}

		// Handle completion events
		if (event?.type === "response.done" || event?.type === "response.completed") {
			const usage = event?.response?.usage || event?.usage || undefined
			const usageData = this.normalizeUsage(usage, model)
			if (usageData) {
				yield usageData
			}
			return
		}

		// Fallbacks for legacy formats
		if (event?.choices?.[0]?.delta?.content) {
			yield { type: "text", text: event.choices[0].delta.content }
			return
		}

		if (event?.usage) {
			const usageData = this.normalizeUsage(event.usage, model)
			if (usageData) {
				yield usageData
			}
		}
	}

	abort(): void {
		this.abortController?.abort()
	}

	getModel(): { id: OpenAiCodexModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId

		const id = modelId && modelId in openAiCodexModels ? (modelId as OpenAiCodexModelId) : openAiCodexDefaultModelId

		const info: ModelInfo = openAiCodexModels[id]

		return { id, info }
	}
}
