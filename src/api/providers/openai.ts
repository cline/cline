import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI, { AzureOpenAI } from "openai"
import { withRetry } from "../retry"
import {
	ApiHandlerOptions,
	azureOpenAiDefaultApiVersion,
	ModelInfo,
	OpenAIConfig,
	openAiModelInfoSaneDefaults,
} from "@shared/api"
import { ApiHandler } from "../index"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import { convertToR1Format } from "../transform/r1-format"
import type { ChatCompletionReasoningEffort } from "openai/resources/chat/completions"

export class OpenAiHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: OpenAI

	constructor(options: ApiHandlerOptions) {
		this.options = options
		// Azure API shape slightly differs from the core API shape: https://github.com/openai/openai-node?tab=readme-ov-file#microsoft-azure-openai
		// Use azureApiVersion to determine if this is an Azure endpoint, since the URL may not always contain 'azure.com'
		if (
			this.options.azure?.apiVersion ||
			((this.getOpenAIConfig().baseUrl?.toLowerCase().includes("azure.com") ||
				this.getOpenAIConfig().baseUrl?.toLowerCase().includes("azure.us")) &&
				!this.getOpenAIConfig().modelId?.toLowerCase().includes("deepseek"))
		) {
			this.client = new AzureOpenAI({
				baseURL: this.getOpenAIConfig().baseUrl,
				apiKey: this.getOpenAIConfig().apiKey,
				apiVersion: this.options.azure?.apiVersion || azureOpenAiDefaultApiVersion,
				defaultHeaders: this.getOpenAIConfig().headers,
			})
		} else {
			this.client = new OpenAI({
				baseURL: this.getOpenAIConfig().baseUrl,
				apiKey: this.getOpenAIConfig().apiKey,
				defaultHeaders: this.getOpenAIConfig().headers,
			})
		}
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const modelId = this.getOpenAIConfig().modelId ?? ""
		const isDeepseekReasoner = modelId.includes("deepseek-reasoner")
		const isR1FormatRequired = this.getOpenAIConfig().modelInfo?.isR1FormatRequired ?? false
		const isReasoningModelFamily = modelId.includes("o1") || modelId.includes("o3") || modelId.includes("o4")

		let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]
		let temperature: number | undefined =
			this.getOpenAIConfig().modelInfo?.temperature ?? openAiModelInfoSaneDefaults.temperature
		let reasoningEffort: ChatCompletionReasoningEffort | undefined = undefined
		let maxTokens: number | undefined

		const modelInfoMaxTokens = this.getOpenAIConfig().modelInfo?.maxTokens
		if (modelInfoMaxTokens && modelInfoMaxTokens > 0) {
			maxTokens = Number(modelInfoMaxTokens)
		} else {
			maxTokens = undefined
		}

		if (isDeepseekReasoner || isR1FormatRequired) {
			openAiMessages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
		}

		if (isReasoningModelFamily) {
			openAiMessages = [{ role: "developer", content: systemPrompt }, ...convertToOpenAiMessages(messages)]
			temperature = undefined // does not support temperature
			reasoningEffort = (this.options.reasoningEffort as ChatCompletionReasoningEffort) || "medium"
		}

		const stream = await this.client.chat.completions.create({
			model: modelId,
			messages: openAiMessages,
			temperature,
			max_tokens: maxTokens,
			reasoning_effort: reasoningEffort,
			stream: true,
			stream_options: { include_usage: true },
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
					cacheReadTokens: chunk.usage.prompt_tokens_details?.cached_tokens || 0,
					// @ts-ignore-next-line
					cacheWriteTokens: chunk.usage.prompt_cache_miss_tokens || 0,
				}
			}
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		return {
			id: this.getOpenAIConfig().modelId ?? "",
			info: this.getOpenAIConfig().modelInfo ?? openAiModelInfoSaneDefaults,
		}
	}

	/**
	 * Get the OpenAI configuration
	 */
	private getOpenAIConfig(): OpenAIConfig {
		if (!this.options.openai) {
			throw new Error("OpenAI configuration is required")
		}
		return this.options.openai
	}
}
