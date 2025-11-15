import { ModelInfo, NousResearchModelId, nousResearchDefaultModelId, nousResearchModels } from "@shared/api"
import OpenAI from "openai"
import { ClineStorageMessage } from "@/shared/messages/content"
import { ApiHandler, CommonApiHandlerOptions } from "../index"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

interface NousResearchHandlerOptions extends CommonApiHandlerOptions {
	nousResearchApiKey?: string
	apiModelId?: string
}

export class NousResearchHandler implements ApiHandler {
	private options: NousResearchHandlerOptions
	private client: OpenAI | undefined

	constructor(options: NousResearchHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.nousResearchApiKey) {
				throw new Error("NousResearch API key is required")
			}
			try {
				this.client = new OpenAI({
					baseURL: "https://inference-api.nousResearch.com/v1",
					apiKey: this.options.nousResearchApiKey,
				})
			} catch (error: any) {
				throw new Error(`Error creating NousResearch client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[]): ApiStream {
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

	getModel(): { id: NousResearchModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId

		if (modelId && modelId in nousResearchModels) {
			const id = modelId as NousResearchModelId
			return { id, info: nousResearchModels[id] }
		}
		return { id: nousResearchDefaultModelId, info: nousResearchModels[nousResearchDefaultModelId] }
	}
}
