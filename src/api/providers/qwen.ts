import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { ApiHandler } from "../"
import {
	ModelInfo,
	mainlandQwenModels,
	internationalQwenModels,
	mainlandQwenDefaultModelId,
	internationalQwenDefaultModelId,
	MainlandQwenModelId,
	InternationalQwenModelId,
} from "@shared/api"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import { convertToR1Format } from "../transform/r1-format"
import { withRetry } from "../retry"

interface QwenHandlerOptions {
	qwenApiKey?: string
	qwenApiLine?: string
	apiModelId?: string
	thinkingBudgetTokens?: number
}

export class QwenHandler implements ApiHandler {
	private options: QwenHandlerOptions
	private client: OpenAI | undefined

	constructor(options: QwenHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.qwenApiKey) {
				throw new Error("Alibaba API key is required")
			}
			try {
				this.client = new OpenAI({
					baseURL:
						this.options.qwenApiLine === "china"
							? "https://dashscope.aliyuncs.com/compatible-mode/v1"
							: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
					apiKey: this.options.qwenApiKey,
				})
			} catch (error: any) {
				throw new Error(`Error creating Alibaba client: ${error.message}`)
			}
		}
		return this.client
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

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const client = this.ensureClient()
		const model = this.getModel()
		const isDeepseekReasoner = model.id.includes("deepseek-r1")
		const isReasoningModelFamily = model.id.includes("qwen3") || ["qwen-plus-latest", "qwen-turbo-latest"].includes(model.id)

		let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		let temperature: number | undefined = 0
		// Configuration for extended thinking
		const budgetTokens = this.options.thinkingBudgetTokens || 0
		const reasoningOn = budgetTokens !== 0 ? true : false
		const thinkingArgs = isReasoningModelFamily
			? {
					enable_thinking: reasoningOn,
					thinking_budget: reasoningOn ? budgetTokens : undefined,
				}
			: undefined

		if (isDeepseekReasoner || (reasoningOn && isReasoningModelFamily)) {
			openAiMessages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
			temperature = undefined
		}

		const stream = await client.chat.completions.create({
			model: model.id,
			max_completion_tokens: model.info.maxTokens,
			messages: openAiMessages,
			stream: true,
			stream_options: { include_usage: true },
			temperature,
			...thinkingArgs,
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
