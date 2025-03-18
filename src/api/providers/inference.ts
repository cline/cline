import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { ApiHandler } from "../"
import { ApiHandlerOptions, ModelInfo } from "../../shared/api"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

export type InferenceModelId = "meta-llama/llama-3.1-8b-instruct/fp-8" | "meta-llama/llama-3.1-70b-instruct/fp-8"

export const inferenceModels: Record<InferenceModelId, ModelInfo> = {
	"meta-llama/llama-3.1-8b-instruct/fp-8": {
		maxTokens: 4096,
		supportsPromptCache: false,
	},
	"meta-llama/llama-3.1-70b-instruct/fp-8": {
		maxTokens: 4096,
		supportsPromptCache: false,
	},
}

export const inferenceDefaultModelId: InferenceModelId = "meta-llama/llama-3.1-8b-instruct/fp-8"

export class InferenceHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: OpenAI

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new OpenAI({
			baseURL: "https://api.inference.net/v1",
			apiKey: this.options.inferenceApiKey || process.env.INFERENCE_API_KEY,
		})
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const stream = await this.client.chat.completions.create({
			model: this.getModel().id,
			max_tokens: this.getModel().info.maxTokens,
			temperature: 0,
			messages: [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
			stream: true,
		})

		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			// Inference.net might have different usage format, adjust as needed
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

	getModel(): { id: InferenceModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in inferenceModels) {
			const id = modelId as InferenceModelId
			return { id, info: inferenceModels[id] }
		}
		return {
			id: inferenceDefaultModelId,
			info: inferenceModels[inferenceDefaultModelId],
		}
	}
}
