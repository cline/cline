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

	@withRetry({ maxRetries: 3 })
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: ChatCompletionTool[]): ApiStream {
		const client = this.ensureClient()
		const model = this.getModel()
		const toolCallProcessor = new ToolCallProcessor()

		const stream = await client.chat.completions.create({
			model: model.id,
			messages: [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
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
				yield* toolCallProcessor.processToolCallDeltas(delta.tool_calls)
			}

			if (chunk.usage) {
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
	}

	getModel(): { id: GitHubCopilotModelId; info: ModelInfo } {
		const modelId = this.options.gitHubCopilotModelId
		if (modelId && modelId in gitHubCopilotModels) {
			const id = modelId as GitHubCopilotModelId
			const info = gitHubCopilotModels[id]
			return { id, info: { ...info } }
		}
		return {
			id: gitHubCopilotDefaultModelId,
			info: { ...gitHubCopilotModels[gitHubCopilotDefaultModelId] },
		}
	}
}
