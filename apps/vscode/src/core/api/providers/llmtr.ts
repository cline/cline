import { type LlmtrModelId, llmtrDefaultModelId, llmtrModels, type ModelInfo } from "@shared/api"
import OpenAI from "openai"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import { ClineStorageMessage } from "@/shared/messages/content"
import { createOpenAIClient } from "@/shared/net"
import { ApiHandler, CommonApiHandlerOptions } from "../index"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import { getOpenAIToolParams, ToolCallProcessor } from "../transform/tool-call-processor"

interface LlmtrHandlerOptions extends CommonApiHandlerOptions {
	llmtrApiKey?: string
	apiModelId?: string
}

export class LlmtrHandler implements ApiHandler {
	private client: OpenAI | undefined

	constructor(private readonly options: LlmtrHandlerOptions) {}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.llmtrApiKey) {
				throw new Error("LLMTR API key is required")
			}
			try {
				this.client = createOpenAIClient({
					baseURL: "https://llmtr.com/v1",
					apiKey: this.options.llmtrApiKey,
				})
			} catch (error) {
				throw new Error(`Error creating LLMTR client: ${error instanceof Error ? error.message : String(error)}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: OpenAITool[]): ApiStream {
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
			...getOpenAIToolParams(tools),
		})
		const toolCallProcessor = new ToolCallProcessor()
		for await (const chunk of stream) {
			const delta = chunk.choices?.[0]?.delta
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			if (delta?.tool_calls) {
				yield* toolCallProcessor.processToolCallDeltas(delta.tool_calls)
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

	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.apiModelId

		if (modelId !== undefined && modelId in llmtrModels) {
			return { id: modelId, info: llmtrModels[modelId as LlmtrModelId] }
		}
		return { id: llmtrDefaultModelId, info: llmtrModels[llmtrDefaultModelId] }
	}
}
