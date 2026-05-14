import { type ModelInfo, nvidiaDefaultModelId, nvidiaDefaultModelInfo, openAiModelInfoSaneDefaults } from "@shared/api"
import OpenAI from "openai"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import { ClineStorageMessage } from "@/shared/messages/content"
import { addNvidiaBillingOriginHeader, createOpenAIClient, NVIDIA_NIM_BASE_URL } from "@/shared/net"
import { ApiHandler, CommonApiHandlerOptions } from "../index"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { convertToR1Format } from "../transform/r1-format"
import { ApiStream } from "../transform/stream"
import { getOpenAIToolParams, ToolCallProcessor } from "../transform/tool-call-processor"

interface NvidiaHandlerOptions extends CommonApiHandlerOptions {
	nvidiaApiKey?: string
	apiModelId?: string
}

export class NvidiaHandler implements ApiHandler {
	private client: OpenAI | undefined

	constructor(private readonly options: NvidiaHandlerOptions) {}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.nvidiaApiKey) {
				throw new Error("NVIDIA API key is required")
			}
			try {
				this.client = createOpenAIClient({
					baseURL: NVIDIA_NIM_BASE_URL,
					apiKey: this.options.nvidiaApiKey,
					defaultHeaders: addNvidiaBillingOriginHeader(),
				})
			} catch (error) {
				throw new Error(`Error creating NVIDIA NIM client: ${error instanceof Error ? error.message : String(error)}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: OpenAITool[]): ApiStream {
		const client = this.ensureClient()
		const model = this.getModel()
		const isR1FormatRequired = model.info && "isR1FormatRequired" in model.info && model.info.isR1FormatRequired

		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = isR1FormatRequired
			? convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
			: [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)]

		const stream = await client.chat.completions.create({
			model: model.id,
			messages: openAiMessages,
			temperature: model.info.temperature ?? 0,
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

			if (delta && "reasoning" in delta && delta.reasoning) {
				yield {
					type: "reasoning",
					reasoning: typeof delta.reasoning === "string" ? delta.reasoning : JSON.stringify(delta.reasoning),
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

	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.apiModelId?.trim()

		if (modelId === nvidiaDefaultModelId) {
			return { id: nvidiaDefaultModelId, info: nvidiaDefaultModelInfo }
		}

		if (modelId) {
			return { id: modelId, info: openAiModelInfoSaneDefaults }
		}

		return { id: nvidiaDefaultModelId, info: nvidiaDefaultModelInfo }
	}
}
