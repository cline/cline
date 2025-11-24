import { BasetenModelId, basetenDefaultModelId, basetenModels, ModelInfo } from "@shared/api"
import { calculateApiCostOpenAI } from "@utils/cost"
import OpenAI from "openai"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import { ClineStorageMessage } from "@/shared/messages/content"
import { fetch } from "@/shared/net"
import { ApiHandler, CommonApiHandlerOptions } from "../"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import { ToolCallProcessor } from "../transform/tool-call-processor"

interface BasetenHandlerOptions extends CommonApiHandlerOptions {
	basetenApiKey?: string
	basetenModelId?: string
	basetenModelInfo?: ModelInfo
	apiModelId?: string // For backward compatibility
}

export class BasetenHandler implements ApiHandler {
	private options: BasetenHandlerOptions
	private client: OpenAI | undefined

	constructor(options: BasetenHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.basetenApiKey) {
				throw new Error("Baseten API key is required")
			}
			try {
				this.client = new OpenAI({
					baseURL: "https://inference.baseten.co/v1",
					apiKey: this.options.basetenApiKey,
					fetch, // Use configured fetch with proxy support
				})
			} catch (error) {
				throw new Error(`Error creating Baseten client: ${error.message}`)
			}
		}
		return this.client
	}

	/**
	 * Gets the optimal max_tokens based on model capabilities
	 */
	private getOptimalMaxTokens(model: { id: BasetenModelId; info: ModelInfo }): number {
		// Use model-specific max tokens if available
		if (model.info.maxTokens && model.info.maxTokens > 0) {
			return model.info.maxTokens
		}

		// Default fallback
		return 8192
	}

	getModel(): { id: BasetenModelId; info: ModelInfo } {
		// First priority: basetenModelId and basetenModelInfo
		const basetenModelId = this.options.basetenModelId
		const basetenModelInfo = this.options.basetenModelInfo
		if (basetenModelId && basetenModelInfo) {
			return { id: basetenModelId as BasetenModelId, info: basetenModelInfo }
		}

		// Second priority: basetenModelId with static model info
		if (basetenModelId && basetenModelId in basetenModels) {
			const id = basetenModelId as BasetenModelId
			return { id, info: basetenModels[id] }
		}

		// Third priority: apiModelId (for backward compatibility)
		const apiModelId = this.options.apiModelId
		if (apiModelId && apiModelId in basetenModels) {
			const id = apiModelId as BasetenModelId
			return { id, info: basetenModels[id] }
		}

		// Default fallback
		return {
			id: basetenDefaultModelId,
			info: basetenModels[basetenDefaultModelId],
		}
	}

	private async *yieldUsage(modelInfo: ModelInfo, usage: any): ApiStream {
		if (usage.prompt_tokens || usage.completion_tokens) {
			const cost = calculateApiCostOpenAI(modelInfo, usage.prompt_tokens || 0, usage.completion_tokens || 0)

			yield {
				type: "usage",
				inputTokens: usage.prompt_tokens || 0,
				outputTokens: usage.completion_tokens || 0,
				cacheWriteTokens: 0,
				cacheReadTokens: 0,
				totalCost: cost,
			}
		}
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: OpenAITool[]): ApiStream {
		const client = this.ensureClient()
		const model = this.getModel()
		const maxTokens = this.getOptimalMaxTokens(model)
		const toolCallProcessor = new ToolCallProcessor()

		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		const stream = await client.chat.completions.create({
			model: model.id,
			max_tokens: maxTokens,
			messages: openAiMessages,
			stream: true,
			stream_options: { include_usage: true },
			temperature: 0,
			tools,
			tool_choice: tools && tools.length > 0 ? "auto" : undefined,
		})

		let didOutputUsage = false

		for await (const chunk of stream) {
			const delta = chunk?.choices?.[0]?.delta

			// Handle reasoning field if present (for reasoning models with parsed output)
			if (delta && "reasoning" in delta && delta?.reasoning) {
				const reasoning = typeof delta.reasoning === "string" ? delta.reasoning : JSON.stringify(delta.reasoning)
				yield {
					type: "reasoning",
					reasoning,
				}
			}

			// Handle content field
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			if (delta?.tool_calls) {
				yield* toolCallProcessor.processToolCallDeltas(delta.tool_calls)
			}

			// Handle usage information - only output once
			if (!didOutputUsage && chunk.usage) {
				yield* this.yieldUsage(model.info, chunk.usage)
				didOutputUsage = true
			}
		}
	}

	/**
	 * Checks if the current model supports tools
	 */
	supportsTools(): boolean {
		const model = this.getModel()
		const modelInfo = model.info as any

		// Use dynamic API data when available, fallback to true since all current Baseten models support tools
		// (as of 2025-09-16 - could change if Baseten add non-tool models in future, currently no plans to do so)
		return modelInfo.supportedFeatures ? modelInfo.supportedFeatures.includes("tools") : true
	}
}
