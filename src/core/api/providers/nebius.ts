import { Anthropic } from "@anthropic-ai/sdk"
import { type ModelInfo, type NebiusModelId, nebiusDefaultModelId, nebiusModels } from "@shared/api"
import OpenAI from "openai"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import { fetch } from "@/shared/net"
import { ApiHandler, CommonApiHandlerOptions } from "../index"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { convertToR1Format } from "../transform/r1-format"
import { ApiStream } from "../transform/stream"
import { getOpenAIToolParams, ToolCallProcessor } from "../transform/tool-call-processor"

interface NebiusHandlerOptions extends CommonApiHandlerOptions {
	nebiusApiKey?: string
	apiModelId?: string
}

export class NebiusHandler implements ApiHandler {
	private client: OpenAI | undefined

	constructor(private readonly options: NebiusHandlerOptions) {}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.nebiusApiKey) {
				throw new Error("Nebius API key is required")
			}
			try {
				this.client = new OpenAI({
					baseURL: "https://api.studio.nebius.ai/v1",
					apiKey: this.options.nebiusApiKey,
					fetch, // Use configured fetch with proxy support
				})
			} catch (error) {
				throw new Error(`Error creating Nebius client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[], tools?: OpenAITool[]): ApiStream {
		const client = this.ensureClient()
		const model = this.getModel()

		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = model.id.includes("DeepSeek-R1")
			? convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
			: [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)]

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

		if (modelId !== undefined && modelId in nebiusModels) {
			return { id: modelId, info: nebiusModels[modelId as NebiusModelId] }
		}
		return { id: nebiusDefaultModelId, info: nebiusModels[nebiusDefaultModelId] }
	}
}
