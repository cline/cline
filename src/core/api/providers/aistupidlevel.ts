import { Anthropic } from "@anthropic-ai/sdk"
import { ModelInfo } from "@shared/api"
import OpenAI from "openai"
import { ApiHandler, CommonApiHandlerOptions } from "../"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

interface AIStupidLevelHandlerOptions extends CommonApiHandlerOptions {
	aiStupidLevelApiKey?: string
	apiModelId?: string
}

// AI Stupid Level models - auto-routing models
export type AIStupidLevelModelId = keyof typeof aiStupidLevelModels
export const aiStupidLevelDefaultModelId: AIStupidLevelModelId = "auto-coding"

export const aiStupidLevelModels = {
	auto: {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"Automatically selects the best overall model based on real-time benchmarks. Your router intelligently chooses between Claude, GPT, Gemini, and xAI models for optimal performance.",
	},
	"auto-coding": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"Optimized for coding tasks. Automatically selects the best-performing model for code generation, debugging, and software development based on continuous benchmarks.",
	},
	"auto-reasoning": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"Optimized for complex reasoning and problem-solving. Selects models that excel at logical thinking, analysis, and multi-step reasoning tasks.",
	},
	"auto-creative": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"Optimized for creative tasks. Selects models that excel at creative writing, brainstorming, and generating innovative ideas.",
	},
	"auto-fastest": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"Prioritizes speed. Automatically selects the fastest-responding model while maintaining good quality for time-sensitive tasks.",
	},
	"auto-cheapest": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"Optimizes for cost. Selects the most cost-effective model that still delivers quality results, perfect for budget-conscious usage.",
	},
} as const satisfies Record<string, ModelInfo>

export class AIStupidLevelHandler implements ApiHandler {
	private options: AIStupidLevelHandlerOptions
	private client: OpenAI | undefined

	constructor(options: AIStupidLevelHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.aiStupidLevelApiKey) {
				throw new Error("AI Stupid Level API key is required. Get yours at https://aistupidlevel.info/router/keys")
			}
			try {
				this.client = new OpenAI({
					baseURL: "https://aistupidlevel.info:4000/v1",
					apiKey: this.options.aiStupidLevelApiKey,
				})
			} catch (error: any) {
				throw new Error(`Error creating AI Stupid Level client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const client = this.ensureClient()
		const modelId = this.getModel().id

		const stream = await client.chat.completions.create({
			model: modelId,
			max_tokens: this.getModel().info.maxTokens,
			temperature: 0,
			messages: [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
			stream: true,
			stream_options: { include_usage: true },
		})

		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			if (chunk.usage) {
				yield {
					type: "usage",
					inputTokens: chunk.usage.prompt_tokens || 0,
					outputTokens: chunk.usage.completion_tokens || 0,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
				}
			}
		}
	}

	getModel(): { id: AIStupidLevelModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in aiStupidLevelModels) {
			const id = modelId as AIStupidLevelModelId
			return { id, info: aiStupidLevelModels[id] }
		}
		return {
			id: aiStupidLevelDefaultModelId,
			info: aiStupidLevelModels[aiStupidLevelDefaultModelId],
		}
	}
}
