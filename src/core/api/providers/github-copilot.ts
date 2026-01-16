import {
	GitHubCopilotModelId,
	gitHubCopilotDefaultModelId,
	gitHubCopilotModels,
	ModelInfo,
} from "@shared/api"
import OpenAI from "openai"
import type { ChatCompletionTool } from "openai/resources/chat/completions"
import { ClineStorageMessage } from "@/shared/messages/content"
import { fetch } from "@/shared/net"
import { ApiHandler, CommonApiHandlerOptions } from "../"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import { getOpenAIToolParams, ToolCallProcessor } from "../transform/tool-call-processor"

// GitHub Copilot OAuth Client ID (from OpenCode)
export const GITHUB_COPILOT_CLIENT_ID = "Ov23li8tweQw6odWQebz"

// GitHub Copilot API base URL
const GITHUB_COPILOT_API_BASE_URL = "https://api.githubcopilot.com"

export interface GitHubCopilotHandlerOptions extends CommonApiHandlerOptions {
	gitHubCopilotAccessToken?: string
	gitHubCopilotModelId?: string
	gitHubCopilotEnterpriseUrl?: string
}

function getBaseUrl(enterpriseUrl?: string): string {
	if (enterpriseUrl) {
		// Remove protocol and trailing slash from enterprise URL
		const domain = enterpriseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")
		return `https://copilot-api.${domain}`
	}
	return GITHUB_COPILOT_API_BASE_URL
}

export class GitHubCopilotHandler implements ApiHandler {
	private options: GitHubCopilotHandlerOptions
	private client: OpenAI | undefined

	constructor(options: GitHubCopilotHandlerOptions) {
		console.error("[GitHub Copilot] Handler constructor called with:", {
			hasToken: !!options.gitHubCopilotAccessToken,
			modelId: options.gitHubCopilotModelId,
			enterpriseUrl: options.gitHubCopilotEnterpriseUrl,
		})
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.gitHubCopilotAccessToken) {
				throw new Error("GitHub Copilot access token is required. Please log in to GitHub Copilot first.")
			}

			const baseUrl = getBaseUrl(this.options.gitHubCopilotEnterpriseUrl)

			// Create a custom fetch that adds Copilot-specific headers
			const copilotFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
				const headers = new Headers(init?.headers)

				// Add Copilot-specific headers
				headers.set("User-Agent", "cline/1.0")
				headers.set("Openai-Intent", "conversation-edits")
				headers.set("X-Initiator", "agent")

				// Check if this is a vision request (has images in the body)
				if (init?.body) {
					try {
						const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body
						if (body?.messages) {
							const hasImages = body.messages.some(
								(msg: any) =>
									Array.isArray(msg.content) &&
									msg.content.some((part: any) => part.type === "image_url")
							)
							if (hasImages) {
								headers.set("Copilot-Vision-Request", "true")
							}
						}
					} catch {
						// Ignore JSON parse errors
					}
				}

				// Remove default authorization and set Copilot bearer token
				headers.delete("Authorization")
				headers.set("Authorization", `Bearer ${this.options.gitHubCopilotAccessToken}`)

				return fetch(input, { ...init, headers })
			}

			try {
				this.client = new OpenAI({
					apiKey: "", // Not used, we set auth in custom fetch
					baseURL: baseUrl,
					fetch: copilotFetch,
				})
			} catch (error: any) {
				throw new Error(`Error creating GitHub Copilot client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry({ maxRetries: 0 }) // Set to 3 after debugging
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: ChatCompletionTool[]): ApiStream {
		console.log("[GitHub Copilot] createMessage called")
		console.log("[GitHub Copilot] Token present:", !!this.options.gitHubCopilotAccessToken)
		console.log("[GitHub Copilot] Model ID:", this.options.gitHubCopilotModelId)

		try {
			const client = this.ensureClient()
			const model = this.getModel()
			console.log("[GitHub Copilot] Using model:", model.id)
			const toolCallProcessor = new ToolCallProcessor()

			// Debug: log messages before conversion
			console.log("[GitHub Copilot] Messages count:", messages.length)
			messages.forEach((msg, i) => {
				console.log(`[GitHub Copilot] Message ${i}: role=${msg.role}, content type=${typeof msg.content}, isArray=${Array.isArray(msg.content)}`)
				if (Array.isArray(msg.content)) {
					msg.content.forEach((part, j) => {
						console.log(`[GitHub Copilot]   Part ${j}: type=${part?.type}, hasContent=${!!part}`)
					})
				}
			})

			let convertedMessages
			try {
				convertedMessages = convertToOpenAiMessages(messages)
				console.log("[GitHub Copilot] Converted messages count:", convertedMessages.length)
			} catch (conversionError: any) {
				console.error("[GitHub Copilot] Message conversion failed:", conversionError)
				console.error("[GitHub Copilot] Raw messages:", JSON.stringify(messages, null, 2))
				throw conversionError
			}

			const stream = await client.chat.completions.create({
			model: model.id,
			messages: [{ role: "system", content: systemPrompt }, ...convertedMessages],
			stream: true,
			stream_options: { include_usage: true },
			...getOpenAIToolParams(tools, false),
		})

		for await (const chunk of stream) {
			const delta = chunk.choices?.[0]?.delta
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			if (delta?.tool_calls) {
				try {
					yield* toolCallProcessor.processToolCallDeltas(delta.tool_calls)
				} catch (error) {
					console.error("Error processing tool call delta:", error, delta.tool_calls)
				}
			}

			if (chunk.usage) {
				// Only last chunk contains usage
				const inputTokens = chunk.usage.prompt_tokens || 0
				const outputTokens = chunk.usage.completion_tokens || 0
				yield {
					type: "usage",
					inputTokens,
					outputTokens,
					totalCost: 0, // Free with Copilot subscription
				}
			}
		}
		} catch (error: any) {
			console.error("[GitHub Copilot] API Error:", error)
			console.error("[GitHub Copilot] Error message:", error?.message)
			console.error("[GitHub Copilot] Error status:", error?.status)
			console.error("[GitHub Copilot] Error response:", error?.response)
			throw error
		}
	}

	getModel(): { id: GitHubCopilotModelId; info: ModelInfo } {
		console.error("[GitHub Copilot] getModel called, modelId:", this.options.gitHubCopilotModelId)
		const modelId = this.options.gitHubCopilotModelId
		if (modelId && modelId in gitHubCopilotModels) {
			const id = modelId as GitHubCopilotModelId
			const info = gitHubCopilotModels[id]
			console.error("[GitHub Copilot] getModel returning:", { id, info: !!info })
			return { id, info: { ...info } }
		}
		console.error("[GitHub Copilot] getModel returning default:", gitHubCopilotDefaultModelId)
		return {
			id: gitHubCopilotDefaultModelId,
			info: { ...gitHubCopilotModels[gitHubCopilotDefaultModelId] },
		}
	}
}
