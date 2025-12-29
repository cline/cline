import Cerebras from "@cerebras/cerebras_cloud_sdk"
import { CerebrasModelId, cerebrasDefaultModelId, cerebrasModels, ModelInfo } from "@shared/api"
import { ClineStorageMessage } from "@/shared/messages/content"
import { fetch } from "@/shared/net"
import { ApiHandler, CommonApiHandlerOptions } from "../index"
import { withRetry } from "../retry"
import { ApiStream } from "../transform/stream"

interface CerebrasHandlerOptions extends CommonApiHandlerOptions {
	cerebrasApiKey?: string
	apiModelId?: string
}

export class CerebrasHandler implements ApiHandler {
	private options: CerebrasHandlerOptions
	private client: Cerebras | undefined

	constructor(options: CerebrasHandlerOptions) {
		this.options = options
	}

	private ensureClient(): Cerebras {
		if (!this.client) {
			// Clean and validate the API key
			const cleanApiKey = this.options.cerebrasApiKey?.trim()

			if (!cleanApiKey) {
				throw new Error("Cerebras API key is required")
			}

			try {
				this.client = new Cerebras({
					apiKey: cleanApiKey,
					timeout: 30000, // 30 second timeout
					fetch, // Use configured fetch with proxy support
					defaultHeaders: {
						"X-Cerebras-3rd-Party-Integration": "cline",
					},
				})
			} catch (error) {
				throw new Error(`Error creating Cerebras client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry({
		maxRetries: 6, // More retries to be patient with rate limits
		baseDelay: 5000, // Start with 5 second delay
		maxDelay: 60000, // Allow up to 60 second delays to respect rate limits
	})
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[]): ApiStream {
		const client = this.ensureClient()

		// Convert Anthropic messages to Cerebras format
		const cerebrasMessages: Array<{
			role: "system" | "user" | "assistant"
			content: string
		}> = [{ role: "system", content: systemPrompt }]

		// Helper function to strip thinking tags from content
		const stripThinkingTags = (content: string): string => {
			return content.replace(/<think>[\s\S]*?<\/think>/g, "").trim()
		}

		// Check if this is a reasoning model that uses thinking tags
		const modelId = this.getModel().id
		const isReasoningModel = modelId.includes("qwen")

		// Convert Anthropic messages to Cerebras format
		for (const message of messages) {
			if (message.role === "user") {
				const content = Array.isArray(message.content)
					? message.content
							.map((block) => {
								if (block.type === "text") {
									return block.text
								} else if (block.type === "image") {
									return "[Image content not supported in Cerebras]"
								}
								return ""
							})
							.join("\n")
					: message.content
				cerebrasMessages.push({ role: "user", content })
			} else if (message.role === "assistant") {
				let content = Array.isArray(message.content)
					? message.content
							.map((block) => {
								if (block.type === "text") {
									return block.text
								}
								return ""
							})
							.join("\n")
					: message.content || ""

				// Strip thinking tags from assistant messages for reasoning models
				// so the model doesn't see its own thinking in the conversation history
				if (isReasoningModel) {
					content = stripThinkingTags(content)
				}

				cerebrasMessages.push({ role: "assistant", content })
			}
		}

		try {
			const stream = await client.chat.completions.create({
				model: this.getModel().id,
				messages: cerebrasMessages,
				temperature: 0,
				stream: true,
				max_tokens: this.getModel().info.maxTokens,
			})

			// Handle streaming response
			let reasoning: string | null = null // Track reasoning content for models that support thinking

			for await (const chunk of stream as any) {
				// Type assertion for the streaming chunk
				const streamChunk = chunk as any

				if (streamChunk.choices?.[0]?.delta?.content) {
					const content = streamChunk.choices[0].delta.content

					// Handle reasoning models (Qwen and DeepSeek R1 Distill) that use <think> tags
					if (isReasoningModel) {
						// Check if we're entering or continuing reasoning mode
						if (reasoning || content.includes("<think>")) {
							reasoning = (reasoning || "") + content

							// Clean the content by removing think tags for display
							const cleanContent = content.replace(/<think>/g, "").replace(/<\/think>/g, "")

							// Only yield reasoning content if there's actual content after cleaning
							if (cleanContent.trim()) {
								yield {
									type: "reasoning",
									reasoning: cleanContent,
								}
							}

							// Check if reasoning is complete
							if (reasoning.includes("</think>")) {
								reasoning = null
							}
						} else {
							// Regular content outside of thinking tags
							yield {
								type: "text",
								text: content,
							}
						}
					} else {
						// Non-reasoning models - just yield text content
						yield {
							type: "text",
							text: content,
						}
					}
				}

				// Handle usage information from Cerebras API
				// Usage is typically only available in the final chunk
				if (streamChunk.usage) {
					const totalCost = this.calculateCost({
						inputTokens: streamChunk.usage.prompt_tokens || 0,
						outputTokens: streamChunk.usage.completion_tokens || 0,
					})

					yield {
						type: "usage",
						inputTokens: streamChunk.usage.prompt_tokens || 0,
						outputTokens: streamChunk.usage.completion_tokens || 0,
						cacheReadTokens: 0,
						cacheWriteTokens: 0,
						totalCost,
					}
				}
			}
		} catch (error: any) {
			// Enhanced error handling for Cerebras API
			if (error?.status === 429 || error?.code === "rate_limit_exceeded") {
				// Rate limit error - will be handled by retry decorator with patient backoff
				const _limits = this.getRateLimits()
				throw new Error(`Cerebras API rate limit exceeded.`)
			} else if (error?.status === 401) {
				throw new Error("Cerebras API authentication failed. Please check your API key.")
			} else if (error?.status === 403) {
				throw new Error("Cerebras API access denied. Please check your API key permissions.")
			} else if (error?.status >= 500) {
				// Server errors - retryable
				throw new Error(`Cerebras API server error (${error.status}): ${error.message || "Unknown server error"}`)
			} else if (error?.status === 400) {
				// Client errors - not retryable
				throw new Error(`Cerebras API bad request: ${error.message || "Invalid request parameters"}`)
			}

			// Re-throw original error for other cases
			throw error
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		const originalModelId = this.options.apiModelId
		let apiModelId = originalModelId
		if (originalModelId === "qwen-3-coder-480b-free") {
			apiModelId = "qwen-3-coder-480b"
			return { id: apiModelId, info: cerebrasModels[originalModelId as CerebrasModelId] }
		}

		if (originalModelId && originalModelId in cerebrasModels) {
			const id = originalModelId as CerebrasModelId
			return { id, info: cerebrasModels[id] }
		}
		return {
			id: cerebrasDefaultModelId,
			info: cerebrasModels[cerebrasDefaultModelId],
		}
	}

	/**
	 * Get rate limit information for the current model
	 *
	 * These limits are used for informational purposes and to calculate appropriate
	 * retry delays. Since Cerebras inference is extremely fast, users hit these limits
	 * quickly, so we need to be patient with retries to maximize usage efficiency.
	 *
	 * @returns Rate limit configuration for the model
	 */
	private getRateLimits(): { requestsPerMinute: number; tokensPerMinute: number } {
		const modelId = this.getModel().id

		switch (modelId) {
			case "qwen-3-coder-480b":
			case "qwen-3-coder-480b-free":
				return { requestsPerMinute: 10, tokensPerMinute: 150_000 }
			case "qwen-3-235b-a22b-instruct-2507":
			case "qwen-3-235b-a22b-thinking-2507":
				return { requestsPerMinute: 30, tokensPerMinute: 60_000 }
			case "llama-3.3-70b":
			case "gpt-oss-120b":
			case "qwen-3-32b":
				return { requestsPerMinute: 30, tokensPerMinute: 64_000 }
			default:
				// Default rate limits for unknown models
				return { requestsPerMinute: 30, tokensPerMinute: 60_000 }
		}
	}

	private calculateCost({ inputTokens, outputTokens }: { inputTokens: number; outputTokens: number }): number {
		const model = this.getModel()
		const inputPrice = model.info.inputPrice || 0
		const outputPrice = model.info.outputPrice || 0

		const inputCost = (inputPrice / 1_000_000) * inputTokens
		const outputCost = (outputPrice / 1_000_000) * outputTokens

		return inputCost + outputCost
	}
}
