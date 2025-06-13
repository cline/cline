import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { unboundDefaultModelId, unboundDefaultModelInfo } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"

import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { addCacheBreakpoints as addAnthropicCacheBreakpoints } from "../transform/caching/anthropic"
import { addCacheBreakpoints as addGeminiCacheBreakpoints } from "../transform/caching/gemini"
import { addCacheBreakpoints as addVertexCacheBreakpoints } from "../transform/caching/vertex"

import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { RouterProvider } from "./router-provider"

const ORIGIN_APP = "roo-code"

const DEFAULT_HEADERS = {
	"X-Unbound-Metadata": JSON.stringify({ labels: [{ key: "app", value: "roo-code" }] }),
}

interface UnboundUsage extends OpenAI.CompletionUsage {
	cache_creation_input_tokens?: number
	cache_read_input_tokens?: number
}

type UnboundChatCompletionCreateParamsStreaming = OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming & {
	unbound_metadata: {
		originApp: string
		taskId?: string
		mode?: string
	}
}

type UnboundChatCompletionCreateParamsNonStreaming = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & {
	unbound_metadata: {
		originApp: string
	}
}

export class UnboundHandler extends RouterProvider implements SingleCompletionHandler {
	constructor(options: ApiHandlerOptions) {
		super({
			options,
			name: "unbound",
			baseURL: "https://api.getunbound.ai/v1",
			apiKey: options.unboundApiKey,
			modelId: options.unboundModelId,
			defaultModelId: unboundDefaultModelId,
			defaultModelInfo: unboundDefaultModelInfo,
		})
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const { id: modelId, info } = await this.fetchModel()

		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		if (info.supportsPromptCache) {
			if (modelId.startsWith("google/")) {
				addGeminiCacheBreakpoints(systemPrompt, openAiMessages)
			} else if (modelId.startsWith("anthropic/")) {
				addAnthropicCacheBreakpoints(systemPrompt, openAiMessages)
			}
		}
		// Custom models from Vertex AI (no configuration) need to be handled differently.
		if (modelId.startsWith("vertex-ai/google.") || modelId.startsWith("vertex-ai/anthropic.")) {
			addVertexCacheBreakpoints(messages)
		}

		// Required by Anthropic; other providers default to max tokens allowed.
		let maxTokens: number | undefined

		if (modelId.startsWith("anthropic/")) {
			maxTokens = info.maxTokens ?? undefined
		}

		const requestOptions: UnboundChatCompletionCreateParamsStreaming = {
			model: modelId.split("/")[1],
			max_tokens: maxTokens,
			messages: openAiMessages,
			stream: true,
			unbound_metadata: {
				originApp: ORIGIN_APP,
				taskId: metadata?.taskId,
				mode: metadata?.mode,
			},
		}

		if (this.supportsTemperature(modelId)) {
			requestOptions.temperature = this.options.modelTemperature ?? 0
		}

		const { data: completion } = await this.client.chat.completions
			.create(requestOptions, { headers: DEFAULT_HEADERS })
			.withResponse()

		for await (const chunk of completion) {
			const delta = chunk.choices[0]?.delta
			const usage = chunk.usage as UnboundUsage

			if (delta?.content) {
				yield { type: "text", text: delta.content }
			}

			if (usage) {
				const usageData: ApiStreamUsageChunk = {
					type: "usage",
					inputTokens: usage.prompt_tokens || 0,
					outputTokens: usage.completion_tokens || 0,
				}

				// Only add cache tokens if they exist.
				if (usage.cache_creation_input_tokens) {
					usageData.cacheWriteTokens = usage.cache_creation_input_tokens
				}

				if (usage.cache_read_input_tokens) {
					usageData.cacheReadTokens = usage.cache_read_input_tokens
				}

				yield usageData
			}
		}
	}

	async completePrompt(prompt: string): Promise<string> {
		const { id: modelId, info } = await this.fetchModel()

		try {
			const requestOptions: UnboundChatCompletionCreateParamsNonStreaming = {
				model: modelId.split("/")[1],
				messages: [{ role: "user", content: prompt }],
				unbound_metadata: {
					originApp: ORIGIN_APP,
				},
			}

			if (this.supportsTemperature(modelId)) {
				requestOptions.temperature = this.options.modelTemperature ?? 0
			}

			if (modelId.startsWith("anthropic/")) {
				requestOptions.max_tokens = info.maxTokens
			}

			const response = await this.client.chat.completions.create(requestOptions, { headers: DEFAULT_HEADERS })
			return response.choices[0]?.message.content || ""
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`Unbound completion error: ${error.message}`)
			}

			throw error
		}
	}
}
