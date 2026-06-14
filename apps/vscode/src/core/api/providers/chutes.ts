import { type ChutesModelId, chutesDefaultModelId, chutesModels, type ModelInfo, openAiModelInfoSaneDefaults } from "@shared/api"
import OpenAI from "openai"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import { ClineStorageMessage } from "@/shared/messages/content"
import { createOpenAIClient } from "@/shared/net"
import { ApiHandler, CommonApiHandlerOptions } from "../index"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import { getOpenAIToolParams, ToolCallProcessor } from "../transform/tool-call-processor"

interface ChutesHandlerOptions extends CommonApiHandlerOptions {
	chutesApiKey?: string
	apiModelId?: string
}

export class ChutesHandler implements ApiHandler {
	private client: OpenAI | undefined

	constructor(private readonly options: ChutesHandlerOptions) {}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.chutesApiKey) {
				throw new Error("Chutes API key is required")
			}
			try {
				this.client = createOpenAIClient({
					baseURL: "https://llm.chutes.ai/v1",
					apiKey: this.options.chutesApiKey,
				})
			} catch (error) {
				throw new Error(`Error creating Chutes client: ${error instanceof Error ? error.message : String(error)}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: OpenAITool[]): ApiStream {
		const client = this.ensureClient()
		const model = this.getModel()

		const stream = await client.chat.completions.create({
			model: model.id,
			messages: [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
			temperature: 0,
			stream: true,
			stream_options: { include_usage: true },
			...getOpenAIToolParams(tools),
		})

		const toolCallProcessor = new ToolCallProcessor()

		// Chutes' gateway forces `continuous_usage_stats` for billing, so it attaches a
		// cumulative `usage` object to *every* streamed chunk rather than only the final
		// one (as the OpenAI streaming contract prescribes). Retain just the latest
		// snapshot and emit a single usage chunk after the stream completes; yielding one
		// per chunk would let the totals be summed and inflate the token/context count.
		let usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number } | undefined

		for await (const chunk of stream) {
			const delta = chunk.choices?.[0]?.delta
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

			if (delta?.tool_calls) {
				yield* toolCallProcessor.processToolCallDeltas(delta.tool_calls)
			}

			if (chunk.usage) {
				const cacheReadTokens = chunk.usage.prompt_tokens_details?.cached_tokens || 0
				usage = {
					inputTokens: chunk.usage.prompt_tokens || 0,
					outputTokens: chunk.usage.completion_tokens || 0,
					// Only surface cache reads when they actually occurred, so a present
					// `cacheReadTokens` is a real signal rather than a constant 0.
					...(cacheReadTokens > 0 ? { cacheReadTokens } : {}),
				}
			}
		}

		if (usage) {
			yield {
				type: "usage",
				...usage,
			}
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.apiModelId?.trim()

		if (modelId && modelId in chutesModels) {
			return { id: modelId, info: chutesModels[modelId as ChutesModelId] }
		}

		if (modelId) {
			return { id: modelId, info: openAiModelInfoSaneDefaults }
		}

		return { id: chutesDefaultModelId, info: chutesModels[chutesDefaultModelId] }
	}
}
