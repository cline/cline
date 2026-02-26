import { ModelInfo, OpenAiCompatibleModelInfo, openAiModelInfoSaneDefaults } from "@shared/api"
import OpenAI, { APIError } from "openai"
import type { ChatCompletionReasoningEffort, ChatCompletionTool } from "openai/resources/chat/completions"
import { OpenAIAuthService } from "@/services/auth/openai/OpenAIAuthService"
import { ClineStorageMessage } from "@/shared/messages/content"
import { fetch } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import { ApiHandler, CommonApiHandlerOptions } from "../index"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { convertToR1Format } from "../transform/r1-format"
import { ApiStream } from "../transform/stream"
import { getOpenAIToolParams, ToolCallProcessor } from "../transform/tool-call-processor"

interface OpenAiOAuthHandlerOptions extends CommonApiHandlerOptions {
	openAiOAuthAuthUrl?: string
	openAiOAuthBaseUrl?: string
	openAiOAuthClientId?: string
	openAiOAuthClientSecret?: string
	openAiOAuthHeaders?: Record<string, string>
	openAiOAuthModelId?: string
	openAiOAuthModelInfo?: OpenAiCompatibleModelInfo
	openAiOAuthScopes?: string
	openAiOAuthTokenUrl?: string
	reasoningEffort?: string
	taskId?: string
}

export class OpenAiOAuthHandler implements ApiHandler {
	protected options: OpenAiOAuthHandlerOptions
	protected client: OpenAI | undefined

	constructor(options: OpenAiOAuthHandlerOptions) {
		this.options = options
	}

	protected async initializeClient(options: OpenAiOAuthHandlerOptions): Promise<OpenAI> {
		Logger.debug("[OpenAI OAuth] Initializing OpenAI client with fresh OAuth token")
		return new (class OpenAIOAuthOpenAI extends OpenAI {
			protected override async prepareOptions(options: any): Promise<void> {
				const token = await OpenAIAuthService.getInstance().getAuthToken()
				if (!token) {
					throw new Error("Unable to handle auth, OpenAI OAuth access token is not available")
				}
				Logger.log("Making OpenAI OAuth request")
				return super.prepareOptions(options)
			}

			protected override makeStatusError(
				status: number,
				error: Object,
				message: string | undefined,
				headers: Headers,
			): APIError {
				interface OpenAIError {
					code?: string
					message?: string
				}
				let openAiOAuthMessage = message
				if (typeof error === "object" && error !== null) {
					try {
						openAiOAuthMessage = JSON.stringify(error)
						const openAiOAuthError = error as OpenAIError
						if (openAiOAuthError.code !== undefined && openAiOAuthError.message !== undefined) {
							openAiOAuthMessage = `${openAiOAuthError.code}: ${openAiOAuthError.message}`
						}
					} catch {}
				}
				const statusCode = typeof status === "number" ? status : 500
				return super.makeStatusError(statusCode, error ?? {}, openAiOAuthMessage, headers)
			}
		})({
			apiKey: async () => (await OpenAIAuthService.getInstance().getAuthToken()) || "",
			baseURL: options.openAiOAuthBaseUrl,
			fetch, // Use configured fetch with proxy support
		})
	}

	private async ensureClient(): Promise<OpenAI> {
		if (!this.client) {
			if (!this.options.openAiOAuthModelId) {
				throw new Error("OpenAI OAuth model is not selected")
			}
			try {
				this.client = await this.initializeClient(this.options)
			} catch (error: any) {
				throw new Error(`Error creating OpenAI OAuth client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: ChatCompletionTool[]): ApiStream {
		const client = await this.ensureClient()
		const modelId = this.options.openAiOAuthModelId ?? ""
		const isDeepseekReasoner = modelId.includes("deepseek-reasoner")
		const isR1FormatRequired = this.options.openAiOAuthModelInfo?.isR1FormatRequired ?? false
		const isReasoningModelFamily =
			["o1", "o3", "o4", "gpt-5"].some((prefix) => modelId.includes(prefix)) && !modelId.includes("chat")

		let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]
		let temperature: number | undefined
		if (this.options.openAiOAuthModelInfo?.temperature !== undefined) {
			const tempValue = Number(this.options.openAiOAuthModelInfo.temperature)
			temperature = tempValue === 0 ? undefined : tempValue
		} else {
			temperature = openAiModelInfoSaneDefaults.temperature
		}
		let reasoningEffort: ChatCompletionReasoningEffort | undefined
		let maxTokens: number | undefined

		if (this.options.openAiOAuthModelInfo?.maxTokens && this.options.openAiOAuthModelInfo.maxTokens > 0) {
			maxTokens = Number(this.options.openAiOAuthModelInfo.maxTokens)
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

		const stream = await client.chat.completions.create({
			model: modelId,
			messages: openAiMessages,
			temperature,
			max_tokens: maxTokens,
			reasoning_effort: reasoningEffort,
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

	getModel(): { id: string; info: ModelInfo } {
		return {
			id: this.options.openAiOAuthModelId || "",
			info: this.options.openAiOAuthModelInfo ?? openAiModelInfoSaneDefaults,
		}
	}
}
