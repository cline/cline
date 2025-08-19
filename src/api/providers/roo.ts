import { Anthropic } from "@anthropic-ai/sdk"
import { rooDefaultModelId, rooModels, type RooModelId } from "@roo-code/types"
import { CloudService } from "@roo-code/cloud"

import type { ApiHandlerOptions } from "../../shared/api"
import { ApiStream } from "../transform/stream"
import { t } from "../../i18n"

import type { ApiHandlerCreateMessageMetadata } from "../index"
import { BaseOpenAiCompatibleProvider } from "./base-openai-compatible-provider"

export class RooHandler extends BaseOpenAiCompatibleProvider<RooModelId> {
	constructor(options: ApiHandlerOptions) {
		// Check if CloudService is available and get the session token.
		if (!CloudService.hasInstance()) {
			throw new Error(t("common:errors.roo.authenticationRequired"))
		}

		const sessionToken = CloudService.instance.authService?.getSessionToken()

		if (!sessionToken) {
			throw new Error(t("common:errors.roo.authenticationRequired"))
		}

		super({
			...options,
			providerName: "Roo Code Cloud",
			baseURL: process.env.ROO_CODE_PROVIDER_URL ?? "https://api.roocode.com/proxy/v1",
			apiKey: sessionToken,
			defaultProviderModelId: rooDefaultModelId,
			providerModels: rooModels,
			defaultTemperature: 0.7,
		})
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const stream = await this.createStream(systemPrompt, messages, metadata)

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
