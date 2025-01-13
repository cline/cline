import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { ApiHandler } from ".."
import { ApiHandlerOptions, YiModelId, ModelInfo, yiDefaultModelId, yiModels } from "../../shared/api"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

export class YiHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: OpenAI

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new OpenAI({
			baseURL: "https://api.lingyiwanwu.com/v1",
			apiKey: this.options.yiApiKey,
		})
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		let userPrompts = convertToOpenAiMessages(messages)
		const stream = await this.client.chat.completions.create({
			model: this.getModel().id,
			max_completion_tokens: this.getModel().info.maxTokens,
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
				}
			}
		}
	}
	getModel(): { id: YiModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in yiModels) {
			const id = modelId as YiModelId
			return { id, info: yiModels[id] }
		}
		return {
			id: yiDefaultModelId,
			info: yiModels[yiDefaultModelId],
		}
	}
}
