import { Anthropic } from "@anthropic-ai/sdk"
import { burncloudDefaultModelId, burncloudModels, ModelInfo } from "@shared/api"
import OpenAI from "openai"
import { ApiHandler, CommonApiHandlerOptions } from "../index"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

interface BurnCloudHandlerOptions extends CommonApiHandlerOptions {
	burncloudApiKey?: string
	burncloudBaseUrl?: string
	apiModelId?: string
}

export class BurnCloudHandler implements ApiHandler {
	private options: BurnCloudHandlerOptions
	private client: OpenAI | undefined

	constructor(options: BurnCloudHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.burncloudApiKey) {
				throw new Error("BurnCloud API key is required")
			}
			try {
				this.client = new OpenAI({
					baseURL: this.options.burncloudBaseUrl || "https://ai.burncloud.com/v1",
					apiKey: this.options.burncloudApiKey,
				})
			} catch (error: any) {
				throw new Error(`Error creating BurnCloud client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const client = this.ensureClient()
		const model = this.getModel()

		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		const stream = await client.chat.completions.create({
			model: model.id,
			messages: openAiMessages,
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
		const modelId = this.options.apiModelId

		if (modelId && modelId in burncloudModels) {
			return { id: modelId, info: burncloudModels[modelId as keyof typeof burncloudModels] }
		}
		return { id: burncloudDefaultModelId, info: burncloudModels[burncloudDefaultModelId] }
	}
}
