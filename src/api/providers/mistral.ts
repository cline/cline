import { Anthropic } from "@anthropic-ai/sdk"
import { Mistral } from "@mistralai/mistralai"
import { ApiHandler } from "../"
import {
	ApiHandlerOptions,
	mistralDefaultModelId,
	MistralModelId,
	mistralModels,
	ModelInfo,
	openAiNativeDefaultModelId,
	OpenAiNativeModelId,
	openAiNativeModels,
} from "../../shared/api"
import { convertToMistralMessages } from "../transform/mistral-format"
import { ApiStream } from "../transform/stream"

const MISTRAL_DEFAULT_TEMPERATURE = 0

export class MistralHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: Mistral

	constructor(options: ApiHandlerOptions) {
		this.options = options
		const baseUrl = this.getBaseUrl()
		console.log("MistralHandler: baseUrl", baseUrl)
		this.client = new Mistral({
			serverURL: baseUrl,
			apiKey: this.options.mistralApiKey,
		})
	}

	private getBaseUrl(): string {
		const modelId = this.options.apiModelId
		if (modelId?.startsWith("codestral-")) {
			return this.options.mistralCodestralUrl || "https://codestral.mistral.ai"
		}
		return "https://api.mistral.ai"
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const response = await this.client.chat.stream({
			model: this.options.apiModelId || mistralDefaultModelId,
			messages: convertToMistralMessages(messages),
			maxTokens: this.options.includeMaxTokens ? this.getModel().info.maxTokens : undefined,
			temperature: this.options.modelTemperature ?? MISTRAL_DEFAULT_TEMPERATURE,
		})

		for await (const chunk of response) {
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
