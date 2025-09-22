import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { AuthState, rooDefaultModelId, rooModels, type RooModelId } from "@roo-code/types"
import { CloudService } from "@roo-code/cloud"

import type { ApiHandlerOptions } from "../../shared/api"
import { ApiStream } from "../transform/stream"

import type { ApiHandlerCreateMessageMetadata } from "../index"
import { DEFAULT_HEADERS } from "./constants"
import { BaseOpenAiCompatibleProvider } from "./base-openai-compatible-provider"

export class RooHandler extends BaseOpenAiCompatibleProvider<RooModelId> {
	private authStateListener?: (state: { state: AuthState }) => void

	constructor(options: ApiHandlerOptions) {
		let sessionToken: string | undefined = undefined

		if (CloudService.hasInstance()) {
			sessionToken = CloudService.instance.authService?.getSessionToken()
		}

		// Always construct the handler, even without a valid token.
		// The provider-proxy server will return 401 if authentication fails.
		super({
			...options,
			providerName: "Roo Code Cloud",
			baseURL: process.env.ROO_CODE_PROVIDER_URL ?? "https://api.roocode.com/proxy/v1",
			apiKey: sessionToken || "unauthenticated", // Use a placeholder if no token.
			defaultProviderModelId: rooDefaultModelId,
			providerModels: rooModels,
			defaultTemperature: 0.7,
		})

		if (CloudService.hasInstance()) {
			const cloudService = CloudService.instance

			this.authStateListener = (state: { state: AuthState }) => {
				if (state.state === "active-session") {
					this.client = new OpenAI({
						baseURL: this.baseURL,
						apiKey: cloudService.authService?.getSessionToken() ?? "unauthenticated",
						defaultHeaders: DEFAULT_HEADERS,
					})
				} else if (state.state === "logged-out") {
					this.client = new OpenAI({
						baseURL: this.baseURL,
						apiKey: "unauthenticated",
						defaultHeaders: DEFAULT_HEADERS,
					})
				}
			}

			cloudService.on("auth-state-changed", this.authStateListener)
		}
	}

	dispose() {
		if (this.authStateListener && CloudService.hasInstance()) {
			CloudService.instance.off("auth-state-changed", this.authStateListener)
		}
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const stream = await this.createStream(
			systemPrompt,
			messages,
			metadata,
			metadata?.taskId ? { headers: { "X-Roo-Task-ID": metadata.taskId } } : undefined,
		)

		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta

			if (delta) {
				if (delta.content) {
					yield {
						type: "text",
						text: delta.content,
					}
				}

				if ("reasoning_content" in delta && typeof delta.reasoning_content === "string") {
					yield {
						type: "reasoning",
						text: delta.reasoning_content,
					}
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

	override getModel() {
		const modelId = this.options.apiModelId || rooDefaultModelId
		const modelInfo = this.providerModels[modelId as RooModelId] ?? this.providerModels[rooDefaultModelId]

		if (modelInfo) {
			return { id: modelId as RooModelId, info: modelInfo }
		}

		// Return the requested model ID even if not found, with fallback info.
		return {
			id: modelId as RooModelId,
			info: {
				maxTokens: 16_384,
				contextWindow: 262_144,
				supportsImages: false,
				supportsPromptCache: true,
				inputPrice: 0,
				outputPrice: 0,
			},
		}
	}
}
