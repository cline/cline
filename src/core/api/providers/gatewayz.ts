import { Anthropic } from "@anthropic-ai/sdk"
import { gatewayzDefaultModelId, gatewayzDefaultModelInfo, ModelInfo } from "@shared/api"
import { calculateApiCostOpenAI } from "@utils/cost"
import OpenAI from "openai"
import { ApiHandler, CommonApiHandlerOptions } from "../"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

interface GatewayzHandlerOptions extends CommonApiHandlerOptions {
	gatewayzBaseUrl?: string
	gatewayzApiKey?: string
	gatewayzModelId?: string
	gatewayzModelInfo?: ModelInfo
	reasoningEffort?: string
	thinkingBudgetTokens?: number
}

export class GatewayzHandler implements ApiHandler {
	private options: GatewayzHandlerOptions
	private client: OpenAI | undefined

	constructor(options: GatewayzHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.gatewayzApiKey) {
				throw new Error("Gatewayz API key is required")
			}
			try {
				const baseURL = this.options.gatewayzBaseUrl || "https://api.gatewayz.io"
				this.client = new OpenAI({
					baseURL,
					apiKey: this.options.gatewayzApiKey,
					defaultHeaders: {
						"HTTP-Referer": "https://cline.bot",
						"X-Title": "Cline",
					},
				})
			} catch (error: any) {
				throw new Error(`Error creating Gatewayz client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const client = this.ensureClient()
		const model = this.getModel()

		// Convert messages to OpenAI chat messages
		const openAiMessages = [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)]

		// We'll stream using the OpenAI SDK
		const stream = await client.chat.completions.create({
			model: model.id,
			messages: openAiMessages,
			max_tokens: model.info.maxTokens || undefined,
			temperature: 0,
			stream: true,
			stream_options: { include_usage: true },
		})

		let lastUsage: any

		for await (const chunk of stream) {
			const delta = chunk.choices?.[0]?.delta
			if (delta?.content) {
				yield { type: "text", text: delta.content }
			}

			// Gatewayz (OpenAI-compatible) may include usage in chunks
			if (chunk.usage) {
				lastUsage = chunk.usage
			}
		}

		// After stream finishes, emit usage summary if we can
		if (lastUsage) {
			const inputTokens = lastUsage.prompt_tokens || 0
			const outputTokens = lastUsage.completion_tokens || 0
			const cacheWriteTokens = lastUsage.prompt_tokens_details?.caching_tokens
			const cacheReadTokens = lastUsage.prompt_tokens_details?.cached_tokens

			const totalCost = calculateApiCostOpenAI(model.info, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens)

			yield {
				type: "usage",
				inputTokens,
				outputTokens,
				cacheWriteTokens,
				cacheReadTokens,
				totalCost,
			}
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.gatewayzModelId
		const modelInfo = this.options.gatewayzModelInfo
		if (modelId && modelInfo) {
			return { id: modelId, info: modelInfo }
		}
		return { id: gatewayzDefaultModelId, info: gatewayzDefaultModelInfo }
	}
}
