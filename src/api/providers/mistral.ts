import { Anthropic } from "@anthropic-ai/sdk"
import { Mistral } from "@mistralai/mistralai"
import { withRetry } from "../retry"
import { ApiHandler } from "../"
import { ApiHandlerOptions, mistralDefaultModelId, MistralModelId, mistralModels, ModelInfo } from "@shared/api"
import { convertToMistralMessages } from "../transform/mistral-format"
import { ApiStream } from "../transform/stream"

export class MistralHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: Mistral

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new Mistral({
			apiKey: this.options.mistralApiKey,
		})
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const stream = await this.client.chat
			.stream({
				model: this.getModel().id,
				// max_completion_tokens: this.getModel().info.maxTokens,
				temperature: 0,
				messages: [{ role: "system", content: systemPrompt }, ...convertToMistralMessages(messages)],
				stream: true,
			})
			.catch((err) => {
				// The Mistal SDK uses statusCode instead of status
				// However, if they introduce status for something, I don't want to override it
				if ("statusCode" in err && !("status" in err)) {
					err.status = err.statusCode
				}

				throw err
			})

		for await (const chunk of stream) {
			const delta = chunk.data.choices[0]?.delta
			if (delta?.content) {
				let content: string = ""
				if (typeof delta.content === "string") {
					content = delta.content
				} else if (Array.isArray(delta.content)) {
					content = delta.content.map((c) => (c.type === "text" ? c.text : "")).join("")
				}
				yield {
					type: "text",
					text: content,
				}
			}

			if (chunk.data.usage) {
				yield {
					type: "usage",
					inputTokens: chunk.data.usage.promptTokens || 0,
					outputTokens: chunk.data.usage.completionTokens || 0,
				}
			}
		}
	}

	getModel(): { id: MistralModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in mistralModels) {
			const id = modelId as MistralModelId
			return { id, info: mistralModels[id] }
		}
		return {
			id: mistralDefaultModelId,
			info: mistralModels[mistralDefaultModelId],
		}
	}
}
