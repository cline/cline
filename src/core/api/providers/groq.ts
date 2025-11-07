import { Anthropic } from "@anthropic-ai/sdk"
import { GroqModelId, groqDefaultModelId, groqModels, ModelInfo } from "@shared/api"
import { calculateApiCostOpenAI } from "@utils/cost"
import OpenAI from "openai"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import { fetch } from "@/shared/net"
import { ApiHandler, CommonApiHandlerOptions } from "../"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import { getOpenAIToolParams, ToolCallProcessor } from "../transform/tool-call-processor"

interface GroqHandlerOptions extends CommonApiHandlerOptions {
	groqApiKey?: string
	groqModelId?: string
	groqModelInfo?: ModelInfo
	apiModelId?: string // For backward compatibility
}

// Enhanced usage interface to support Groq's cached token fields
interface GroqUsage extends OpenAI.CompletionUsage {
	prompt_tokens_details?: {
		cached_tokens?: number
	}
}

// Model family definitions for enhanced behavior
interface GroqModelFamily {
	name: string
	supportedFeatures: {
		streaming: boolean
		temperature: boolean
		vision: boolean
		tools: boolean
	}
	maxTokensOverride?: number
	specialParams?: Record<string, any>
}

const MODEL_FAMILIES: Record<string, GroqModelFamily> = {
	// Moonshort 4 Family - Latest generation with vision support
	"kimi-k2": {
		name: "kimi-k2",
		supportedFeatures: { streaming: true, temperature: true, vision: true, tools: true },
		maxTokensOverride: 8192,
	},
	// Llama 4 Family - Latest generation with vision support
	llama4: {
		name: "Llama 4",
		supportedFeatures: { streaming: true, temperature: true, vision: true, tools: true },
		maxTokensOverride: 8192,
	},
	// Llama 3.3 Family - Balanced performance
	"llama3.3": {
		name: "Llama 3.3",
		supportedFeatures: { streaming: true, temperature: true, vision: false, tools: true },
		maxTokensOverride: 32768,
	},
	// Llama 3.1 Family - Fast inference
	"llama3.1": {
		name: "Llama 3.1",
		supportedFeatures: { streaming: true, temperature: true, vision: false, tools: true },
		maxTokensOverride: 131072,
	},
	// DeepSeek Family - Reasoning-optimized
	deepseek: {
		name: "DeepSeek",
		supportedFeatures: { streaming: true, temperature: true, vision: false, tools: true },
		maxTokensOverride: 8192,
		specialParams: {
			top_p: 0.95,
			reasoning_format: "parsed",
		},
	},
	// Qwen Family - Enhanced for Q&A
	qwen: {
		name: "Qwen",
		supportedFeatures: { streaming: true, temperature: true, vision: false, tools: true },
		maxTokensOverride: 32768,
	},
	// Compound Models - Hybrid architectures
	compound: {
		name: "Compound",
		supportedFeatures: { streaming: true, temperature: true, vision: false, tools: true },
		maxTokensOverride: 8192,
	},
}

export class GroqHandler implements ApiHandler {
	private options: GroqHandlerOptions
	private client: OpenAI | undefined

	constructor(options: GroqHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.groqApiKey) {
				throw new Error("Groq API key is required")
			}
			try {
				this.client = new OpenAI({
					baseURL: "https://api.groq.com/openai/v1",
					apiKey: this.options.groqApiKey,
					fetch, // Use configured fetch with proxy support
				})
			} catch (error) {
				throw new Error(`Error creating Groq client: ${error.message}`)
			}
		}
		return this.client
	}

	private async *yieldUsage(info: ModelInfo, usage: GroqUsage | undefined): ApiStream {
		const inputTokens = usage?.prompt_tokens || 0
		const outputTokens = usage?.completion_tokens || 0

		const cacheReadTokens = usage?.prompt_tokens_details?.cached_tokens || 0

		// Groq does not track cache writes
		const cacheWriteTokens = 0

		// Calculate cost using OpenAI-compatible cost calculation
		const totalCost = calculateApiCostOpenAI(info, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens)

		// Calculate non-cached input tokens for proper reporting
		const nonCachedInputTokens = Math.max(0, inputTokens - cacheReadTokens - cacheWriteTokens)

		yield {
			type: "usage",
			inputTokens: nonCachedInputTokens,
			outputTokens,
			cacheWriteTokens,
			cacheReadTokens,
			totalCost,
		}
	}

	/**
	 * Detects the model family based on the model ID
	 */
	private detectModelFamily(modelId: string): GroqModelFamily {
		if (modelId.includes("kimi-k2")) {
			return MODEL_FAMILIES["kimi-k2"]
		}
		// Llama 4 variants
		if (modelId.includes("llama-4") || modelId.includes("llama/llama-4")) {
			return MODEL_FAMILIES.llama4
		}
		// Llama 3.3 variants
		if (modelId.includes("llama-3.3")) {
			return MODEL_FAMILIES["llama3.3"]
		}
		// Llama 3.1 variants
		if (modelId.includes("llama-3.1")) {
			return MODEL_FAMILIES["llama3.1"]
		}
		// DeepSeek variants
		if (modelId.includes("deepseek")) {
			return MODEL_FAMILIES.deepseek
		}
		// Qwen variants
		if (modelId.includes("qwen")) {
			return MODEL_FAMILIES.qwen
		}
		// Compound variants
		if (modelId.includes("compound")) {
			return MODEL_FAMILIES.compound
		}

		// Default fallback to Llama 3.3 behavior
		return MODEL_FAMILIES["kimi-k2"]
	}

	/**
	 * Gets the optimal max_tokens based on model family and capabilities
	 */
	private getOptimalMaxTokens(model: { id: string; info: ModelInfo }, modelFamily: GroqModelFamily): number {
		// Use model-specific max tokens if available
		if (model.info.maxTokens && model.info.maxTokens > 0) {
			return model.info.maxTokens
		}

		// Use family override if available
		if (modelFamily.maxTokensOverride) {
			return modelFamily.maxTokensOverride
		}

		// Default fallback
		return 8192
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[], tools?: OpenAITool[]): ApiStream {
		const client = this.ensureClient()
		const model = this.getModel()
		const modelFamily = this.detectModelFamily(model.id)

		// Optimize parameters based on model family
		const temperature = 0
		const maxTokens = this.getOptimalMaxTokens(model, modelFamily)

		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		// Build request parameters with model-specific optimizations
		const requestParams: OpenAI.Chat.ChatCompletionCreateParamsStreaming & {
			reasoning_format?: "parsed" | "raw" | "hidden"
			top_p?: number
		} = {
			model: model.id,
			max_tokens: maxTokens,
			messages: openAiMessages,
			stream: true,
			stream_options: { include_usage: true },
			temperature,
			...getOpenAIToolParams(tools),
		}

		// Add any special parameters for specific model families
		if (modelFamily.specialParams) {
			Object.assign(requestParams, modelFamily.specialParams)
		}

		const toolCallProcessor = new ToolCallProcessor()
		const stream = await client.chat.completions.create(requestParams)

		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta

			// Handle reasoning field if present (for reasoning models with parsed output)
			if ((delta as any)?.reasoning) {
				const reasoningContent = (delta as any).reasoning as string
				yield {
					type: "reasoning",
					reasoning: reasoningContent,
				}
				continue
			}

			if (delta?.tool_calls) {
				yield* toolCallProcessor.processToolCallDeltas(delta.tool_calls)
			}

			// Handle content field - trust the parsed output from Groq
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			// Handle usage information
			if (chunk.usage) {
				yield* this.yieldUsage(model.info, chunk.usage)
			}
		}
	}

	/**
	 * Checks if the current model supports vision/images
	 */
	supportsImages(): boolean {
		const model = this.getModel()
		return model.info.supportsImages === true
	}

	/**
	 * Checks if the current model supports tools
	 */
	supportsTools(): boolean {
		const model = this.getModel()
		const modelFamily = this.detectModelFamily(model.id)
		return modelFamily.supportedFeatures.tools
	}

	/**
	 * Gets model information with enhanced family detection
	 */
	getModel(): { id: string; info: ModelInfo } {
		// First priority: groqModelId and groqModelInfo (like Requesty does)
		const groqModelId = this.options.groqModelId
		const groqModelInfo = this.options.groqModelInfo
		if (groqModelId && groqModelInfo) {
			return { id: groqModelId, info: groqModelInfo }
		}

		// Second priority: groqModelId with static model info
		if (groqModelId && groqModelId in groqModels) {
			const id = groqModelId as GroqModelId
			return { id, info: groqModels[id] }
		}

		// Third priority: apiModelId (for backward compatibility)
		const apiModelId = this.options.apiModelId
		if (apiModelId && apiModelId in groqModels) {
			const id = apiModelId as GroqModelId
			return { id, info: groqModels[id] }
		}

		// Default fallback
		return {
			id: groqDefaultModelId,
			info: groqModels[groqDefaultModelId],
		}
	}

	/**
	 * Gets model family information for debugging/introspection
	 */
	getModelFamily(): GroqModelFamily {
		const model = this.getModel()
		return this.detectModelFamily(model.id)
	}
}
