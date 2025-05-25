import { Anthropic } from "@anthropic-ai/sdk"
import Cerebras from "@cerebras/cerebras_cloud_sdk"
import { withRetry } from "../retry"
import { ApiHandlerOptions, ModelInfo, CerebrasModelId, cerebrasDefaultModelId, cerebrasModels } from "@shared/api"
import { ApiHandler } from "../index"
import { ApiStream } from "@api/transform/stream"

export class CerebrasHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: Cerebras

	constructor(options: ApiHandlerOptions) {
		this.options = options

		// Clean and validate the API key
		const cleanApiKey = this.options.cerebrasApiKey?.trim()

		if (!cleanApiKey) {
			throw new Error("Cerebras API key is required")
		}

		this.client = new Cerebras({
			apiKey: cleanApiKey,
			timeout: 30000, // 30 second timeout
		})
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		// Convert Anthropic messages to Cerebras format
		const cerebrasMessages: Array<{
			role: "system" | "user" | "assistant"
			content: string
		}> = [{ role: "system", content: systemPrompt }]

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
				const content = Array.isArray(message.content)
					? message.content
							.map((block) => {
								if (block.type === "text") {
									return block.text
								}
								return ""
							})
							.join("\n")
					: message.content || ""
				cerebrasMessages.push({ role: "assistant", content })
			}
		}

		try {
			const stream = await this.client.chat.completions.create({
				model: this.getModel().id,
				messages: cerebrasMessages,
				temperature: 0,
				stream: true,
			})

			// Handle streaming response
			let reasoning: string | null = null // Track reasoning content for models that support thinking
			const modelId = this.getModel().id
			const isReasoningModel = modelId.includes("qwen") || modelId.includes("deepseek-r1-distill")

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
							let cleanContent = content.replace(/<think>/g, "").replace(/<\/think>/g, "")

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
		} catch (error) {
			throw error
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in cerebrasModels) {
			const id = modelId as CerebrasModelId
			return { id, info: cerebrasModels[id] }
		}
		return {
			id: cerebrasDefaultModelId,
			info: cerebrasModels[cerebrasDefaultModelId],
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
