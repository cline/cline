import { Anthropic } from "@anthropic-ai/sdk"
import { Mistral } from "@mistralai/mistralai"
import { ApiHandler } from "../"
import { ApiHandlerOptions, codestralDefaultModelId, CodestralModelId, codestralModels, ModelInfo } from "../../shared/api"
import { withRetry } from "../retry"
import { convertToMistralMessages } from "../transform/mistral-format"
import { ApiStream } from "../transform/stream"

export class CodestralHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: Mistral

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new Mistral({
			serverURL: "https://codestral.mistral.ai",
			apiKey: this.options.codestralApiKey,
		})
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const stream = await this.client.chat.stream({
			model: this.getModel().id,
			temperature: 0,
			messages: [{ role: "system", content: systemPrompt }, ...convertToMistralMessages(messages)],
			stream: true,
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

	getModel(): { id: CodestralModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in codestralModels) {
			const id = modelId as CodestralModelId
			return { id, info: codestralModels[id] }
		}
		return {
			id: codestralDefaultModelId,
			info: codestralModels[codestralDefaultModelId],
		}
	}
}
