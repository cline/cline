import OpenAI from "openai"
import type { ChatCompletionTool } from "openai/resources/chat/completions"
import { buildExternalBasicHeaders } from "@/services/EnvUtils"
import { ClineStorageMessage } from "@/shared/messages/content"
import { createOpenAIClient } from "@/shared/net"
import { ApiHandler, CommonApiHandlerOptions } from "../index"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import { getOpenAIToolParams, ToolCallProcessor } from "../transform/tool-call-processor"

interface NvidiaNimHandlerOptions extends CommonApiHandlerOptions {
	nvidiaApiKey?: string
	nvidiaBaseUrl?: string
	nvidiaModelId?: string
	temperature?: number
	topP?: number
	maxTokens?: number
	enableThinking?: boolean
	clearThinking?: boolean
}

export class NvidiaNimHandler implements ApiHandler {
	private options: NvidiaNimHandlerOptions
	private client: OpenAI | undefined

	constructor(options: NvidiaNimHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.nvidiaApiKey) {
				throw new Error("NVIDIA API key is required")
			}
			
			const externalHeaders = buildExternalBasicHeaders()
			
			this.client = createOpenAIClient({
				baseURL: this.options.nvidiaBaseUrl || "https://integrate.api.nvidia.com/v1",
				apiKey: this.options.nvidiaApiKey,
				defaultHeaders: {
					...externalHeaders,
				},
			})
		}
		return this.client
	}

	@withRetry()
	async *createMessage(
		systemPrompt: string, 
		messages: ClineStorageMessage[], 
		tools?: ChatCompletionTool[]
	): ApiStream {
		const client = this.ensureClient()
		const modelId = this.options.nvidiaModelId ?? "z-ai/glm5"
		
		const openAiMessages = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		// Set up parameters according to NVIDIA NIM specification
		const temperature = this.options.temperature ?? 1
		const topP = this.options.topP ?? 1
		const maxTokens = this.options.maxTokens ?? 16384
		
		// Default to enable thinking for GLM5 models, allow override
		const enableThinking = this.options.enableThinking ?? true
		const clearThinking = this.options.clearThinking ?? false

		const stream = await client.chat.completions.create({
			model: modelId,
			messages: openAiMessages,
			temperature,
			top_p: topP,
			max_tokens: maxTokens,
			stream: true,
			extra_body: {
				chat_template_kwargs: {
					enable_thinking: enableThinking,
					clear_thinking: clearThinking,
				}
			},
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

			// Handle NVIDIA's reasoning format using reasoning_content
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
				yield {
					type: "usage",
					inputTokens: chunk.usage.prompt_tokens || 0,
					outputTokens: chunk.usage.completion_tokens || 0,
					cacheReadTokens: chunk.usage.prompt_tokens_details?.cached_tokens || 0,
					// @ts-expect-error-next-line
					cacheWriteTokens: chunk.usage.prompt_cache_miss_tokens || 0,
				}
			}
		}
	}

	getModel(): { id: string; info: any } {
		return {
			id: this.options.nvidiaModelId ?? "z-ai/glm5",
			info: {
				temperature: this.options.temperature,
				topP: this.options.topP,
				maxTokens: this.options.maxTokens,
				enableThinking: this.options.enableThinking,
				clearThinking: this.options.clearThinking,
			},
		}
	}
}