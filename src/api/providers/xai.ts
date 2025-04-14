import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { ApiHandler } from "../"
import { ApiHandlerOptions, XAIModelId, ModelInfo, xaiDefaultModelId, xaiModels } from "../../shared/api"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import { ChatCompletionReasoningEffort } from "openai/resources/chat/completions.mjs"

export class XAIHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: OpenAI

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new OpenAI({
			baseURL: "https://api.x.ai/v1",
			apiKey: this.options.xaiApiKey,
		})
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const modelId = this.getModel().id
		// ensure reasoning effort is either "low" or "high" for grok-3-mini
		let reasoningEffort: ChatCompletionReasoningEffort | undefined
		if (modelId.includes("3-mini")) {
			let reasoningEffort = this.options.reasoningEffort
			if (reasoningEffort && !["low", "high"].includes(reasoningEffort)) {
				reasoningEffort = undefined
			}
		}
		const stream = await this.client.chat.completions.create({
			model: modelId,
			max_completion_tokens: this.getModel().info.maxTokens,
			temperature: 0,
			messages: [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
			stream: true,
			stream_options: { include_usage: true },
			reasoning_effort: reasoningEffort,
		})

		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			if ("reasoning_content" in delta && delta.reasoning_content) {
				yield {
					type: "reasoning",
					// @ts-ignore-next-line
					reasoning: delta.reasoning_content,
				}
			}

			if (chunk.usage) {
				yield {
					type: "usage",
					inputTokens: 0,
					outputTokens: chunk.usage.completion_tokens || 0,
					// @ts-ignore-next-line
					cacheReadTokens: chunk.usage.prompt_cache_hit_tokens || 0,
					// @ts-ignore-next-line
					cacheWriteTokens: chunk.usage.prompt_cache_miss_tokens || 0,
				}
			}
		}
	}

	getModel(): { id: XAIModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in xaiModels) {
			const id = modelId as XAIModelId
			return { id, info: xaiModels[id] }
		}
		return {
			id: xaiDefaultModelId,
			info: xaiModels[xaiDefaultModelId],
		}
	}
}
