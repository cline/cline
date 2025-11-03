import { Anthropic } from "@anthropic-ai/sdk"
import { heliconeDefaultModelId, heliconeDefaultModelInfo, ModelInfo } from "@shared/api"
import OpenAI from "openai"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import { ApiHandler, CommonApiHandlerOptions } from "../index"
import { withRetry } from "../retry"
import { createHeliconeStream } from "../transform/helicone-stream"
import { ApiStream } from "../transform/stream"
import { ToolCallProcessor } from "../transform/tool-call-processor"

interface HeliconeHandlerOptions extends CommonApiHandlerOptions {
	heliconeApiKey?: string
	heliconeModelId?: string
	heliconeModelInfo?: ModelInfo
}

export class HeliconeHandler implements ApiHandler {
	private options: HeliconeHandlerOptions
	private client: OpenAI | undefined

	constructor(options: HeliconeHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.heliconeApiKey) {
				throw new Error("Helicone API key is required")
			}
			try {
				this.client = new OpenAI({
					baseURL: "https://ai-gateway.helicone.ai",
					apiKey: this.options.heliconeApiKey,
					defaultHeaders: {
						"Helicone-User-Id": "Cline-AI",
						"Helicone-Cache-Enabled": "true",
						"Helicone-Cache-Bucket-Max-Size": "10",
						"Helicone-Cache-Seed": "support-v1",
					},
				})
			} catch (error: any) {
				throw new Error(`Error creating Helicone client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[], tools?: OpenAITool[]): ApiStream {
		const client = this.ensureClient()
		const modelId = this.getModel().id
		const modelInfo = this.getModel().info

		try {
			const stream = await createHeliconeStream(client, systemPrompt, messages, { id: modelId, info: modelInfo }, tools)
			let didOutputUsage: boolean = false

			const toolCallProcessor = new ToolCallProcessor()

			for await (const chunk of stream) {
				const delta = chunk.choices[0]?.delta
				if (delta?.content) {
					yield { type: "text", text: delta.content }
				}
				if (delta?.tool_calls) {
					yield* toolCallProcessor.processToolCallDeltas(delta.tool_calls)
				}
				if (!didOutputUsage && chunk.usage) {
					const inputTokens = chunk.usage.prompt_tokens || 0
					const outputTokens =
						(chunk.usage.completion_tokens || 0) + (chunk.usage.completion_tokens_details?.reasoning_tokens || 0)
					const cacheReadTokens = chunk.usage.prompt_tokens_details?.cached_tokens || 0
					// @ts-ignore - gateway may extend OpenAI types
					const cacheWriteTokens = chunk.usage.cache_creation_input_tokens || 0

					yield {
						type: "usage",
						inputTokens,
						outputTokens,
						cacheWriteTokens,
						cacheReadTokens,
						// @ts-expect-error extended type
						totalCost: chunk.usage.cost || 0,
					}
					didOutputUsage = true
				}
			}

			if (!didOutputUsage) {
				console.warn("Helicone: no usage in stream")
			}
		} catch (error: any) {
			console.error("Helicone error details:", error)
			console.error("Error stack:", error.stack)
			throw new Error(`Helicone error: ${error.message}`)
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.heliconeModelId
		const modelInfo = this.options.heliconeModelInfo
		if (modelId && modelInfo) {
			return { id: modelId, info: modelInfo }
		}
		return { id: heliconeDefaultModelId, info: heliconeDefaultModelInfo }
	}
}
