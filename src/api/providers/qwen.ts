import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { ApiHandler } from "../"
import {
	ApiHandlerOptions,
	ModelInfo,
	mainlandQwenModels,
	internationalQwenModels,
	mainlandQwenDefaultModelId,
	internationalQwenDefaultModelId,
	MainlandQwenModelId,
	InternationalQwenModelId,
} from "../../shared/api"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import { convertToR1Format } from "../transform/r1-format"

export class QwenHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: OpenAI

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new OpenAI({
			baseURL:
				this.options.qwenApiLine === "china"
					? "https://dashscope.aliyuncs.com/compatible-mode/v1"
					: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
			apiKey: this.options.qwenApiKey,
		})
	}

	getModel(): { id: MainlandQwenModelId | InternationalQwenModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		// Branch based on API line to let poor typescript know what to do
		if (this.options.qwenApiLine === "china") {
			return {
				id: (modelId as MainlandQwenModelId) ?? mainlandQwenDefaultModelId,
				info: mainlandQwenModels[modelId as MainlandQwenModelId] ?? mainlandQwenModels[mainlandQwenDefaultModelId],
			}
		} else {
			return {
				id: (modelId as InternationalQwenModelId) ?? internationalQwenDefaultModelId,
				info:
					internationalQwenModels[modelId as InternationalQwenModelId] ??
					internationalQwenModels[internationalQwenDefaultModelId],
			}
		}
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const model = this.getModel()
		const isDeepseekReasoner = model.id.includes("deepseek-r1")
		let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]
		if (isDeepseekReasoner) {
			openAiMessages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
		}
		const stream = await this.client.chat.completions.create({
			model: model.id,
			max_completion_tokens: model.info.maxTokens,
			messages: openAiMessages,
			stream: true,
			stream_options: { include_usage: true },
			...(model.id === "deepseek-r1" ? {} : { temperature: 0 }),
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
					// @ts-ignore-next-line
					cacheReadTokens: chunk.usage.prompt_cache_hit_tokens || 0,
					// @ts-ignore-next-line
					cacheWriteTokens: chunk.usage.prompt_cache_miss_tokens || 0,
				}
			}
		}
	}
}
