import { ModelInfo, SambanovaModelId, sambanovaDefaultModelId, sambanovaModels } from "@shared/api"
import OpenAI from "openai"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import { ClineStorageMessage } from "@/shared/messages/content"
import { fetch } from "@/shared/net"
import { ApiHandler, CommonApiHandlerOptions } from "../index"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { convertToR1Format } from "../transform/r1-format"
import { ApiStream } from "../transform/stream"
import { getOpenAIToolParams, ToolCallProcessor } from "../transform/tool-call-processor"

interface SambanovaHandlerOptions extends CommonApiHandlerOptions {
	sambanovaApiKey?: string
	apiModelId?: string
}

export class SambanovaHandler implements ApiHandler {
	private options: SambanovaHandlerOptions
	private client: OpenAI | undefined

	constructor(options: SambanovaHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.sambanovaApiKey) {
				throw new Error("SambaNova API key is required")
			}
			try {
				this.client = new OpenAI({
					baseURL: "https://api.sambanova.ai/v1",
					apiKey: this.options.sambanovaApiKey,
					fetch, // Use configured fetch with proxy support
				})
			} catch (error: any) {
				throw new Error(`Error creating SambaNova client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: OpenAITool[]): ApiStream {
		const client = this.ensureClient()
		const model = this.getModel()

		let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		const modelId = model.id.toLowerCase()

		if (modelId.includes("deepseek") || modelId.includes("qwen") || modelId.includes("qwq")) {
			openAiMessages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
		}

		const toolCallProcessor = new ToolCallProcessor()
		const stream = await client.chat.completions.create({
			model: this.getModel().id,
			messages: openAiMessages,
			temperature: 0,
			stream: true,
			stream_options: { include_usage: true },
			...getOpenAIToolParams(tools),
		})

		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			if (delta?.tool_calls) {
				yield* toolCallProcessor.processToolCallDeltas(delta.tool_calls)
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
		if (modelId && modelId in sambanovaModels) {
			const id = modelId as SambanovaModelId
			return { id, info: sambanovaModels[id] }
		}
		return {
			id: sambanovaDefaultModelId,
			info: sambanovaModels[sambanovaDefaultModelId],
		}
	}
}
