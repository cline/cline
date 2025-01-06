import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { ApiHandler } from "../"
import { ApiHandlerOptions, ModelInfo } from "../../shared/api"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

interface ApipieCompletionUsage extends OpenAI.CompletionUsage {
	prompt_characters?: number
	response_characters?: number
	latency_ms?: number
	cost?: number
}

interface ApipieStreamResponse extends Omit<OpenAI.Chat.ChatCompletionChunk, "usage"> {
	usage?: ApipieCompletionUsage
}

interface ApipieModel {
	enabled: number
	available: number
	type: string
	subtype: string
	provider: string
	id: string
	model: string
	route: string
	description: string
	max_tokens: number
	max_response_tokens: number
	input_cost: number
	output_cost: number
}

interface ChatCompletionCreateParams {
	model: string
	messages: OpenAI.Chat.ChatCompletionMessageParam[]
	temperature?: number
	stream?: boolean
	tools_model?: string // Added tools_model property
}

export class ApipieHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: OpenAI
	private models: ApipieModel[] = []
	private modelInfo: ApipieModel | null = null

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new OpenAI({
			baseURL: "https://apipie.ai/v1",
			apiKey: this.options.apipieApiKey,
		})
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		// Fetch model info if we haven't already
		if (!this.modelInfo) {
			const response = await fetch("https://apipie.ai/v1/models?subtype=chatx,meta,code", {
				headers: {
					"X-API-Key": this.options.apipieApiKey || "",
				},
			})
			const models = await response.json()
			this.modelInfo = models.data.find((m: ApipieModel) => {
				if (m.available === 1 && m.max_response_tokens >= 8000) {
					m.model = `${m.provider}/${m.id}`
					return `${m.provider}/${m.id}` === this.options.apiModelId
				}
				return false
			})
			if (!this.modelInfo) {
				throw new Error(`Model not found or unavailable: ${this.options.apiModelId}`)
			}
		}

		const stream = await this.client.chat.completions.create({
			model: `${this.modelInfo.provider}/${this.modelInfo.id}`,
			messages: openAiMessages,
			temperature: 0,
			stream: true,
			stream_options: { include_usage: true },
		})

		for await (const chunk of stream) {
			const apipieChunk = chunk as ApipieStreamResponse
			const delta = apipieChunk.choices[0]?.delta
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			if (apipieChunk.usage) {
				yield {
					type: "usage",
					inputTokens: apipieChunk.usage.prompt_tokens || 0,
					outputTokens: apipieChunk.usage.completion_tokens || 0,
					totalCost: apipieChunk.usage.cost || 0,
				}
			}
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		return {
			id: this.modelInfo?.route || this.options.apiModelId || "openai/gpt-4o-mini",
			info: {
				maxTokens: this.modelInfo?.max_tokens || 128000,
				contextWindow: this.modelInfo?.max_response_tokens || 8192,
				supportsImages: false,
				supportsPromptCache: false,
				inputPrice: this.modelInfo?.input_cost || 0,
				outputPrice: this.modelInfo?.output_cost || 0,
				description: this.modelInfo?.description,
			},
		}
	}
}
