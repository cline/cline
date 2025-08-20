import { Anthropic } from "@anthropic-ai/sdk"
import { ModelInfo, vercelAiGatewayDefaultModelId, vercelAiGatewayDefaultModelInfo } from "@shared/api"
import OpenAI from "openai"
import { ApiHandler } from "../index"
import { withRetry } from "../retry"
import { ApiStream } from "../transform/stream"
import { createVercelAIGatewayStream } from "../transform/vercel-ai-gateway-stream"

interface VercelAIGatewayHandlerOptions {
	vercelAiGatewayApiKey?: string
	vercelAiGatewayModelId?: string
	vercelAiGatewayModelInfo?: ModelInfo
}

export class VercelAIGatewayHandler implements ApiHandler {
	private options: VercelAIGatewayHandlerOptions
	private client: OpenAI | undefined

	constructor(options: VercelAIGatewayHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.vercelAiGatewayApiKey) {
				throw new Error("Vercel AI Gateway API key is required")
			}
			try {
				this.client = new OpenAI({
					baseURL: "https://ai-gateway.vercel.sh/v1",
					apiKey: this.options.vercelAiGatewayApiKey,
					defaultHeaders: {
						"http-referer": "https://cline.bot",
						"x-title": "Cline",
					},
				})
			} catch (error: any) {
				throw new Error(`Error creating Vercel AI Gateway client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const client = this.ensureClient()
		const modelId = this.getModel().id
		const modelInfo = this.getModel().info

		try {
			const stream = await createVercelAIGatewayStream(client, systemPrompt, messages, { id: modelId, info: modelInfo })
			let didOutputUsage: boolean = false

			for await (const chunk of stream) {
				const delta = chunk.choices[0]?.delta
				if (delta?.content) {
					yield {
						type: "text",
						text: delta.content,
					}
				}

				if (!didOutputUsage && chunk.usage) {
					const inputTokens = chunk.usage.prompt_tokens || 0
					const outputTokens =
						(chunk.usage.completion_tokens || 0) + (chunk.usage.completion_tokens_details?.reasoning_tokens || 0)

					const cacheReadTokens = chunk.usage.prompt_tokens_details?.cached_tokens || 0
					// @ts-ignore - Vercel AI Gateway extends OpenAI types
					const cacheWriteTokens = chunk.usage.cache_creation_input_tokens || 0

					yield {
						type: "usage",
						inputTokens: inputTokens,
						outputTokens: outputTokens,
						cacheWriteTokens: cacheWriteTokens,
						cacheReadTokens: cacheReadTokens,
						// @ts-expect-error - Vercel AI Gateway extends OpenAI types
						totalCost: chunk.usage.cost || 0,
					}
					didOutputUsage = true
				}
			}

			if (!didOutputUsage) {
				console.warn("Vercel AI Gateway did not provide usage information in stream")
			}
		} catch (error: any) {
			console.error("Vercel AI Gateway error details:", error)
			console.error("Error stack:", error.stack)
			throw new Error(`Vercel AI Gateway error: ${error.message}`)
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.vercelAiGatewayModelId
		const modelInfo = this.options.vercelAiGatewayModelInfo
		if (modelId && modelInfo) {
			return { id: modelId, info: modelInfo }
		}
		return { id: vercelAiGatewayDefaultModelId, info: vercelAiGatewayDefaultModelInfo }
	}
}
