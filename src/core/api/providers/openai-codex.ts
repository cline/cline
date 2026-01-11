import {
	ModelInfo,
	OpenAiCodexModelId,
	OpenAiCompatibleModelInfo,
	openAiCodexDefaultModelId,
	openAiCodexModels,
} from "@shared/api"
import type { ChatCompletionTool } from "openai/resources/chat/completions"
import { Logger } from "@/services/logging/Logger"
import { CodexOAuthTokens, getCodexAuthProvider } from "@/services/auth/providers/CodexAuthProvider"
import { ClineStorageMessage } from "@/shared/messages/content"
import { fetch } from "@/shared/net"
import { ApiHandler, CommonApiHandlerOptions } from "../"
import { withRetry } from "../retry"
import { convertToOpenAIResponsesInput } from "../transform/openai-response-format"
import { ApiStream } from "../transform/stream"

// Codex API endpoint - uses the ChatGPT backend Responses API
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

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: ChatCompletionTool[]): ApiStream {
		// Codex backend ONLY supports the Responses API format
		if (!tools?.length) {
			throw new Error("Native Tool Call must be enabled in your settings for OpenAI Codex")
		}
		yield* this.createCodexResponseStream(systemPrompt, messages, tools)
	}

	/**
	 * Create a streaming response using the Codex Responses API
	 * Note: Codex backend ONLY supports Responses API, not chat completions
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
