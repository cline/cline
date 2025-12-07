import { ModelInfo, openRouterDefaultModelId, openRouterDefaultModelInfo } from "@shared/api"
import OpenAI from "openai"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import { ClineStorageMessage } from "@/shared/messages/content"
import { fetch } from "@/shared/net"
import { ApiHandler, CommonApiHandlerOptions } from "../index"
import { withRetry } from "../retry"
import { ApiStream } from "../transform/stream"
import { ToolCallProcessor } from "../transform/tool-call-processor"
import { createVercelAIGatewayStream } from "../transform/vercel-ai-gateway-stream"

interface VercelAIGatewayHandlerOptions extends CommonApiHandlerOptions {
	vercelAiGatewayApiKey?: string
	openRouterModelId?: string
	openRouterModelInfo?: ModelInfo
	thinkingBudgetTokens?: number
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
					fetch, // Use configured fetch with proxy support
				})
			} catch (error: any) {
				throw new Error(`Error creating Vercel AI Gateway client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: OpenAITool[]): ApiStream {
		const client = this.ensureClient()
		const modelId = this.getModel().id
		const modelInfo = this.getModel().info

		try {
			const stream = await createVercelAIGatewayStream(
				client,
				systemPrompt,
				messages,
				{ id: modelId, info: modelInfo },
				this.options.thinkingBudgetTokens,
				tools,
			)
			let didOutputUsage: boolean = false

			const toolCallProcessor = new ToolCallProcessor()

			for await (const chunk of stream) {
				const delta = chunk.choices[0]?.delta
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
				if ("reasoning" in delta && delta.reasoning) {
					yield {
						type: "reasoning",
						reasoning: typeof delta.reasoning === "string" ? delta.reasoning : JSON.stringify(delta.reasoning),
					}
				}

				// Reasoning details that can be passed back in API requests to preserve reasoning traces
				if (
					"reasoning_details" in delta &&
					delta.reasoning_details &&
					// @ts-expect-error-next-line
					delta.reasoning_details.length // exists and non-0
				) {
					yield {
						type: "reasoning",
						reasoning: "",
						details: delta.reasoning_details,
					}
				}

				if (!didOutputUsage && chunk.usage) {
					// @ts-expect-error - Vercel AI Gateway extends OpenAI types
					const totalCost = (chunk.usage.cost || 0) + (chunk.usage.cost_details?.upstream_inference_cost || 0)

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
		const modelId = this.options.openRouterModelId
		const modelInfo = this.options.openRouterModelInfo
		if (modelId && modelInfo) {
			return { id: modelId, info: modelInfo }
		}
		return { id: openRouterDefaultModelId, info: openRouterDefaultModelInfo }
	}
}
