import type { Anthropic } from "@anthropic-ai/sdk"
import { type ModelInfo, openAiModelInfoSaneDefaults } from "@shared/api"
import OpenAI from "openai"
import type { ApiHandler, CommonApiHandlerOptions } from "../"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import type { ApiStream } from "../transform/stream"
import { LmStudioKeepAliveProxyManager } from "./lmstudio-keepalive-proxy-manager"

interface LmStudioHandlerOptions extends CommonApiHandlerOptions {
	lmStudioBaseUrl?: string
	lmStudioModelId?: string
	lmStudioMaxTokens?: string
	requestTimeoutMs?: number
	lmStudioKeepAliveEnabled?: boolean
}

const PROXY_LOOPBACK_HOST = "127.0.0.1"

export class LmStudioHandler implements ApiHandler {
	private options: LmStudioHandlerOptions
	private client: OpenAI | undefined
	private clientBaseUrl: string | null = null

	constructor(options: LmStudioHandlerOptions) {
		this.options = options
	}

	private async getClient(baseUrl: string): Promise<OpenAI> {
		if (!this.client || this.clientBaseUrl !== baseUrl) {
			try {
				this.client = new OpenAI({
					// Docs on the new v0 api endpoint: https://lmstudio.ai/docs/app/api/endpoints/rest
					baseURL: new URL("api/v0", baseUrl).toString(),
					apiKey: "noop",
				})
				this.clientBaseUrl = baseUrl
			} catch (error) {
				this.client = undefined
				this.clientBaseUrl = null
				throw new Error(`Error creating LM Studio client: ${error.message}`)
			}
		}
		return this.client
	}

	private async resolveBaseUrl(): Promise<string> {
		const base = this.options.lmStudioBaseUrl || "http://localhost:1234"
		const manager = LmStudioKeepAliveProxyManager.getInstance()

		if (this.options.lmStudioKeepAliveEnabled) {
			await manager.ensureProxyRunning(base)
			const proxyPort = manager.getActiveProxyPort()
			if (!proxyPort) {
				throw new Error("Failed to start LM Studio keep-alive proxy.")
			}
			return `http://${PROXY_LOOPBACK_HOST}:${proxyPort}`
		}

		await manager.stopProxy()
		return base
	}

	@withRetry({ retryAllErrors: true })
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const baseUrl = await this.resolveBaseUrl()
		const client = await this.getClient(baseUrl)
		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		const timeoutMs = this.options.requestTimeoutMs || 30000
		const controller = new AbortController()
		let timeoutTriggered = false
		const timeoutId = setTimeout(() => {
			timeoutTriggered = true
			controller.abort()
		}, timeoutMs)

		try {
			const stream = await client.chat.completions.create(
				{
					model: this.getModel().id,
					messages: openAiMessages,
					stream: true,
					stream_options: { include_usage: true },
					max_completion_tokens: this.options.lmStudioMaxTokens ? Number(this.options.lmStudioMaxTokens) : undefined,
				},
				{ signal: controller.signal },
			)
			for await (const chunk of stream) {
				const choice = chunk.choices[0]
				const delta = choice?.delta
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
						cacheReadTokens: chunk.usage.prompt_tokens_details?.cached_tokens || 0,
					}
				}
			}
		} catch (error) {
			if (timeoutTriggered || (error instanceof Error && error.name === "AbortError")) {
				throw new Error(`LM Studio request timed out after ${timeoutMs / 1000} seconds`)
			}
			// LM Studio doesn't return an error code/body for now
			throw new Error(
				"Please check the LM Studio developer logs to debug what went wrong. You may need to load the model with a larger context length to work with Cline's prompts. Alternatively, try enabling Compact Prompt in your settings when working with a limited context window.",
			)
		} finally {
			clearTimeout(timeoutId)
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		const info = { ...openAiModelInfoSaneDefaults }
		const maxTokens = Number(this.options.lmStudioMaxTokens)
		if (!Number.isNaN(maxTokens)) {
			info.contextWindow = maxTokens
		}
		return {
			id: this.options.lmStudioModelId || "",
			info,
		}
	}
}
