import { Anthropic } from "@anthropic-ai/sdk"
import { withRetry } from "../retry"
import OpenAI from "openai"
import { ApiHandlerOptions, ModelInfo, arkModels, openAiModelInfoSaneDefaults } from "../../shared/api"
import { ApiHandler } from "../index"
import { ApiStream } from "../transform/stream"
import { convertToR1Format } from "../transform/r1-format"

interface ArkModel {
	id: string
	max_tokens: number
	context_window: number
	supports_images: boolean
	supports_computer_use: boolean
	supports_prompt_cache: boolean
	input_price: number
	output_price: number
	description: string
}

interface ArkModelsResponse {
	models: ArkModel[]
}

export class ArkHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: OpenAI
	private models: Record<string, ModelInfo> = {}

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new OpenAI({
			baseURL: this.options.arkEndpoint || "https://ark.cn-beijing.volces.com/api/v3",
			apiKey: this.options.arkApiKey,
		})
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const r1Messages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])

		const stream = await this.client.chat.completions.create({
			model: this.options.apiModelId || "",
			messages: r1Messages,
			temperature: 0,
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

			if (delta && "reasoning_content" in delta && delta.reasoning_content) {
				yield {
					type: "reasoning",
					reasoning: (delta.reasoning_content as string | undefined) || "",
				}
			}

			if (chunk.usage) {
				yield {
					type: "usage",
					inputTokens: chunk.usage.prompt_tokens || 0,
					outputTokens: chunk.usage.completion_tokens || 0,
				}
			}
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		console.log("Getting Ark model:", this.options.apiModelId)
		this.models = arkModels

		const modelId = this.options.apiModelId || ""
		const model = modelId in arkModels ? arkModels[modelId as keyof typeof arkModels] : openAiModelInfoSaneDefaults

		return {
			id: modelId,
			info: {
				...model,
			},
		}
	}
}
