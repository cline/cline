import {
	ModelInfo,
	OpenAiCodexModelId,
	OpenAiCompatibleModelInfo,
	openAiCodexDefaultModelId,
	openAiCodexModels,
} from "@shared/api"
import OpenAI from "openai"
import type { ChatCompletionReasoningEffort, ChatCompletionTool } from "openai/resources/chat/completions"
import { Logger } from "@/services/logging/Logger"
import { CodexOAuthTokens, getCodexAuthProvider } from "@/services/auth/providers/CodexAuthProvider"
import { ClineStorageMessage } from "@/shared/messages/content"
import { fetch } from "@/shared/net"
import { ApiFormat } from "@/shared/proto/cline/models"
import { ApiHandler, CommonApiHandlerOptions } from "../"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { convertToOpenAIResponsesInput } from "../transform/openai-response-format"
import { ApiStream } from "../transform/stream"
import { getOpenAIToolParams, ToolCallProcessor } from "../transform/tool-call-processor"

// Codex API endpoint
const CODEX_API_BASE_URL = "https://chatgpt.com/backend-api"

interface OpenAiCodexHandlerOptions extends CommonApiHandlerOptions {
	openAiCodexAccessToken?: string
	openAiCodexRefreshToken?: string
	openAiCodexAccountId?: string
	openAiCodexTokenExpiry?: number
	reasoningEffort?: string
	apiModelId?: string
	// Callback to update stored tokens after refresh
	onTokenRefresh?: (tokens: CodexOAuthTokens) => void
}

export class OpenAiCodexHandler implements ApiHandler {
	private options: OpenAiCodexHandlerOptions
	private client: OpenAI | undefined

	constructor(options: OpenAiCodexHandlerOptions) {
		this.options = options
	}

	/**
	 * Check if we have valid OAuth tokens
	 */
	isAuthenticated(): boolean {
		return !!(this.options.openAiCodexAccessToken && this.options.openAiCodexRefreshToken && this.options.openAiCodexAccountId)
	}

	/**
	 * Ensure we have a valid access token, refreshing if necessary
	 */
	private async ensureValidToken(): Promise<string> {
		if (!this.options.openAiCodexAccessToken || !this.options.openAiCodexRefreshToken) {
			throw new Error("OpenAI Codex: Not authenticated. Please sign in with your ChatGPT account.")
		}

		const expiry = this.options.openAiCodexTokenExpiry || 0
		const authProvider = getCodexAuthProvider()

		if (authProvider.shouldRefreshToken(expiry)) {
			Logger.debug("Codex: Refreshing access token...")
			try {
				const newTokens = await authProvider.refreshAccessToken(this.options.openAiCodexRefreshToken)

				// Update options with new tokens
				this.options.openAiCodexAccessToken = newTokens.accessToken
				this.options.openAiCodexRefreshToken = newTokens.refreshToken
				this.options.openAiCodexAccountId = newTokens.accountId
				this.options.openAiCodexTokenExpiry = newTokens.expiresAt

				// Notify caller to persist the updated tokens
				if (this.options.onTokenRefresh) {
					this.options.onTokenRefresh(newTokens)
				}

				Logger.debug("Codex: Token refreshed successfully")
			} catch (error) {
				Logger.error("Codex: Token refresh failed:", error)
				throw new Error("Failed to refresh Codex token. Please sign in again.")
			}
		}

		return this.options.openAiCodexAccessToken
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			// Create client with dummy key - we'll override the headers for each request
			this.client = new OpenAI({
				apiKey: "codex-oauth-token",
				baseURL: "https://api.openai.com/v1",
				fetch,
			})
		}
		return this.client
	}

	private async *yieldUsage(info: ModelInfo, usage: OpenAI.Completions.CompletionUsage | undefined): ApiStream {
		const inputTokens = usage?.prompt_tokens || 0
		const outputTokens = usage?.completion_tokens || 0
		const cacheReadTokens = usage?.prompt_tokens_details?.cached_tokens || 0
		// Codex is included in subscription, so cost is $0
		yield {
			type: "usage",
			inputTokens: Math.max(0, inputTokens - cacheReadTokens),
			outputTokens,
			cacheWriteTokens: 0,
			cacheReadTokens,
			totalCost: 0,
		}
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: ChatCompletionTool[]): ApiStream {
		const model = this.getModel()

		// Check if we need to use Responses API format
		if (model.info?.apiFormat === ApiFormat.OPENAI_RESPONSES) {
			if (!tools?.length) {
				throw new Error("Native Tool Call must be enabled in your settings for OpenAI Codex Responses API")
			}
			yield* this.createCodexResponseStream(systemPrompt, messages, tools)
		} else {
			yield* this.createCodexCompletionStream(systemPrompt, messages, tools)
		}
	}

	/**
	 * Create a streaming completion using the Codex backend with chat completions format
	 */
	private async *createCodexCompletionStream(
		systemPrompt: string,
		messages: ClineStorageMessage[],
		tools?: ChatCompletionTool[],
	): ApiStream {
		const accessToken = await this.ensureValidToken()
		const model = this.getModel()
		const toolCallProcessor = new ToolCallProcessor()

		const systemRole = model.info.systemRole ?? "system"
		const includeReasoning = model.info.supportsReasoningEffort
		const reasoningEffort = includeReasoning
			? (this.options.reasoningEffort as ChatCompletionReasoningEffort) || "medium"
			: undefined

		// Use direct fetch for Codex API
		const response = await fetch(`${CODEX_API_BASE_URL}/codex/chat/completions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${accessToken}`,
				"ChatGPT-Account-Id": this.options.openAiCodexAccountId!,
				"OpenAI-Beta": "responses=experimental",
				originator: "cline",
			},
			body: JSON.stringify({
				model: model.id,
				messages: [{ role: systemRole, content: systemPrompt }, ...convertToOpenAiMessages(messages)],
				stream: true,
				stream_options: { include_usage: true },
				reasoning_effort: reasoningEffort,
				...(model.info.temperature !== undefined ? { temperature: model.info.temperature } : {}),
				...getOpenAIToolParams(tools, true),
			}),
		})

		if (!response.ok) {
			const errorText = await response.text().catch(() => "")
			throw new Error(`Codex API error ${response.status}: ${errorText}`)
		}

		// Process SSE stream
		const reader = response.body?.getReader()
		if (!reader) {
			throw new Error("No response body")
		}

		const decoder = new TextDecoder()
		let buffer = ""

		while (true) {
			const { done, value } = await reader.read()
			if (done) break

			buffer += decoder.decode(value, { stream: true })
			const lines = buffer.split("\n")
			buffer = lines.pop() || ""

			for (const line of lines) {
				if (!line.startsWith("data: ")) continue
				const data = line.slice(6).trim()
				if (data === "[DONE]") continue

				try {
					const chunk = JSON.parse(data)
					const delta = chunk.choices?.[0]?.delta

					if (delta?.content) {
						yield { type: "text", text: delta.content }
					}

					if (delta?.tool_calls) {
						yield* toolCallProcessor.processToolCallDeltas(delta.tool_calls)
					}

					if (chunk.usage) {
						yield* this.yieldUsage(model.info, chunk.usage)
					}
				} catch (e) {
					Logger.debug("Failed to parse SSE chunk:", data)
				}
			}
		}
	}

	/**
	 * Create a streaming response using the Codex Responses API
	 */
	private async *createCodexResponseStream(
		systemPrompt: string,
		messages: ClineStorageMessage[],
		tools: ChatCompletionTool[],
	): ApiStream {
		const accessToken = await this.ensureValidToken()
		const model = this.getModel()

		// Convert messages to Responses API input format
		const input = convertToOpenAIResponsesInput(messages)

		// Convert ChatCompletion tools to Responses API format
		const responseTools = tools
			?.filter((tool) => tool.type === "function")
			.map((tool: any) => ({
				type: "function" as const,
				name: tool.function.name,
				description: tool.function.description,
				parameters: tool.function.parameters,
				strict: tool.function.strict ?? true,
			}))

		Logger.debug("Codex Responses Input: " + JSON.stringify(input))

		// Use direct fetch for Codex Responses API
		const response = await fetch(`${CODEX_API_BASE_URL}/codex/responses`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${accessToken}`,
				"ChatGPT-Account-Id": this.options.openAiCodexAccountId!,
				"OpenAI-Beta": "responses=experimental",
				originator: "cline",
				accept: "text/event-stream",
			},
			body: JSON.stringify({
				model: model.id,
				instructions: systemPrompt,
				input,
				stream: true,
				tools: responseTools,
				store: false, // Required for Codex backend
				reasoning: { effort: this.options.reasoningEffort || "medium", summary: "auto" },
			}),
		})

		if (!response.ok) {
			const errorText = await response.text().catch(() => "")
			throw new Error(`Codex API error ${response.status}: ${errorText}`)
		}

		// Process SSE stream
		const reader = response.body?.getReader()
		if (!reader) {
			throw new Error("No response body")
		}

		const decoder = new TextDecoder()
		let buffer = ""

		while (true) {
			const { done, value } = await reader.read()
			if (done) break

			buffer += decoder.decode(value, { stream: true })
			const lines = buffer.split("\n")
			buffer = lines.pop() || ""

			for (const line of lines) {
				if (!line.startsWith("data: ")) continue
				const data = line.slice(6).trim()
				if (data === "[DONE]") continue

				try {
					const chunk = JSON.parse(data)
					Logger.debug("Codex Responses Chunk: " + JSON.stringify(chunk))

					// Handle different event types from Responses API
					if (chunk.type === "response.output_item.added") {
						const item = chunk.item
						if (item.type === "function_call" && item.id) {
							yield {
								type: "tool_calls",
								id: item.id,
								tool_call: {
									call_id: item.call_id,
									function: {
										id: item.id,
										name: item.name,
										arguments: item.arguments,
									},
								},
							}
						}
						if (item.type === "reasoning" && item.encrypted_content && item.id) {
							yield {
								type: "reasoning",
								id: item.id,
								reasoning: "",
								redacted_data: item.encrypted_content,
							}
						}
					}

					if (chunk.type === "response.output_item.done") {
						const item = chunk.item
						if (item.type === "function_call") {
							yield {
								type: "tool_calls",
								id: item.id || item.call_id,
								tool_call: {
									call_id: item.call_id,
									function: {
										id: item.id,
										name: item.name,
										arguments: item.arguments,
									},
								},
							}
						}
						if (item.type === "reasoning") {
							yield {
								type: "reasoning",
								id: item.id,
								details: item.summary,
								reasoning: "",
							}
						}
					}

					if (chunk.type === "response.reasoning_summary_part.added") {
						yield {
							type: "reasoning",
							id: chunk.item_id,
							reasoning: chunk.part.text,
						}
					}

					if (chunk.type === "response.reasoning_summary_text.delta") {
						yield {
							type: "reasoning",
							id: chunk.item_id,
							reasoning: chunk.delta,
						}
					}

					if (chunk.type === "response.reasoning_summary_part.done") {
						yield {
							type: "reasoning",
							id: chunk.item_id,
							details: chunk.part,
							reasoning: "",
						}
					}

					if (chunk.type === "response.output_text.delta") {
						if (chunk.delta) {
							yield {
								id: chunk.item_id,
								type: "text",
								text: chunk.delta,
							}
						}
					}

					if (chunk.type === "response.reasoning_text.delta") {
						if (chunk.delta) {
							yield {
								id: chunk.item_id,
								type: "reasoning",
								reasoning: chunk.delta,
							}
						}
					}

					if (chunk.type === "response.function_call_arguments.delta") {
						yield {
							type: "tool_calls",
							tool_call: {
								function: {
									id: chunk.item_id,
									name: chunk.item_id,
									arguments: chunk.delta,
								},
							},
						}
					}

					if (chunk.type === "response.function_call_arguments.done") {
						if (chunk.item_id && chunk.name && chunk.arguments) {
							yield {
								type: "tool_calls",
								tool_call: {
									function: {
										id: chunk.item_id,
										name: chunk.name,
										arguments: chunk.arguments,
									},
								},
							}
						}
					}

					if (chunk.type === "response.completed" && chunk.response?.usage) {
						const usage = chunk.response.usage
						const inputTokens = usage.input_tokens || 0
						const outputTokens = usage.output_tokens || 0
						yield {
							type: "usage",
							inputTokens,
							outputTokens,
							cacheWriteTokens: 0,
							cacheReadTokens: 0,
							totalCost: 0, // Included in subscription
							id: chunk.response.id,
						}
					}
				} catch (e) {
					Logger.debug("Failed to parse SSE chunk:", data)
				}
			}
		}
	}

	getModel(): { id: OpenAiCodexModelId; info: OpenAiCompatibleModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in openAiCodexModels) {
			const id = modelId as OpenAiCodexModelId
			const info = openAiCodexModels[id]
			return { id, info: { ...info } }
		}
		return {
			id: openAiCodexDefaultModelId,
			info: { ...openAiCodexModels[openAiCodexDefaultModelId] },
		}
	}
}
