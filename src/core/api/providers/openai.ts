import { Anthropic } from "@anthropic-ai/sdk"
import { azureOpenAiDefaultApiVersion, ModelInfo, OpenAiCompatibleModelInfo, openAiModelInfoSaneDefaults } from "@shared/api"
import { resolveReasoningEffort, supportsReasoningEffortForModel } from "@shared/reasoning"
import OpenAI, { AzureOpenAI } from "openai"
import type { ChatCompletionReasoningEffort } from "openai/resources/chat/completions"
import { ApiHandler, CommonApiHandlerOptions } from "../index"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { convertToR1Format } from "../transform/r1-format"
import { ApiStream } from "../transform/stream"

interface OpenAiHandlerOptions extends CommonApiHandlerOptions {
	openAiApiKey?: string
	openAiBaseUrl?: string
	azureApiVersion?: string
	openAiHeaders?: Record<string, string>
	openAiModelId?: string
	openAiModelInfo?: OpenAiCompatibleModelInfo
	reasoningEffort?: string
}

export class OpenAiHandler implements ApiHandler {
	private options: OpenAiHandlerOptions
	private client: OpenAI | undefined

	constructor(options: OpenAiHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.openAiApiKey) {
				throw new Error("OpenAI API key is required")
			}
			try {
				// Azure API shape slightly differs from the core API shape: https://github.com/openai/openai-node?tab=readme-ov-file#microsoft-azure-openai
				// Use azureApiVersion to determine if this is an Azure endpoint, since the URL may not always contain 'azure.com'
				if (
					this.options.azureApiVersion ||
					((this.options.openAiBaseUrl?.toLowerCase().includes("azure.com") ||
						this.options.openAiBaseUrl?.toLowerCase().includes("azure.us")) &&
						!this.options.openAiModelId?.toLowerCase().includes("deepseek"))
				) {
					this.client = new AzureOpenAI({
						baseURL: this.options.openAiBaseUrl,
						apiKey: this.options.openAiApiKey,
						apiVersion: this.options.azureApiVersion || azureOpenAiDefaultApiVersion,
						defaultHeaders: this.options.openAiHeaders,
					})
				} else {
					this.client = new OpenAI({
						baseURL: this.options.openAiBaseUrl,
						apiKey: this.options.openAiApiKey,
						defaultHeaders: this.options.openAiHeaders,
					})
				}
			} catch (error: any) {
				throw new Error(`Error creating OpenAI client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const client = this.ensureClient()
		const modelId = this.options.openAiModelId ?? ""
		const modelInfo = this.options.openAiModelInfo
		const isDeepseekReasoner = modelId.includes("deepseek-reasoner")
		const isR1FormatRequired = modelInfo?.isR1FormatRequired ?? false
		// Determine if this is an OpenAI Reasoning model family using heuristics
		const heuristicOpenAiReasoningFamily = supportsReasoningEffortForModel(modelId)
		const isOpenAiReasoningModelFamily = modelInfo?.isReasoningModelFamily ?? heuristicOpenAiReasoningFamily

		const convertedMessages = convertToOpenAiMessages(messages)
		let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertedMessages,
		]
		let temperature: number | undefined = modelInfo?.temperature ?? openAiModelInfoSaneDefaults.temperature
		let reasoningEffort: ChatCompletionReasoningEffort | undefined
		let maxTokens: number | undefined

		if (modelInfo?.maxTokens && modelInfo.maxTokens > 0) {
			maxTokens = Number(modelInfo.maxTokens)
		} else {
			maxTokens = undefined
		}

		// Always resolve reasoning effort if setReasoningEffort option is enabled
		if (modelInfo?.setReasoningEffort) {
			reasoningEffort = resolveReasoningEffort(this.options.reasoningEffort, modelInfo?.reasoningEffort) as
				| ChatCompletionReasoningEffort
				| undefined
		}

		if (isDeepseekReasoner || isR1FormatRequired) {
			openAiMessages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
		} else if (isOpenAiReasoningModelFamily) {
			// OpenAI Reasoning model family: use developer role and disable temperature
			openAiMessages = [{ role: "developer", content: systemPrompt }, ...convertedMessages]
			temperature = undefined // OpenAI reasoning models do not support temperature
		}

		const stream = await client.chat.completions.create({
			model: modelId,
			messages: openAiMessages,
			temperature,
			max_tokens: maxTokens,
			...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
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
			id: this.options.openAiModelId ?? "",
			info: this.options.openAiModelInfo ?? openAiModelInfoSaneDefaults,
		}
	}
}
