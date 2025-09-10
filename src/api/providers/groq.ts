import { type GroqModelId, groqDefaultModelId, groqModels } from "@roo-code/types"
import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import type { ApiHandlerOptions } from "../../shared/api"
import type { ApiHandlerCreateMessageMetadata } from "../index"
import { ApiStream } from "../transform/stream"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { calculateApiCostOpenAI } from "../../shared/cost"

import { BaseOpenAiCompatibleProvider } from "./base-openai-compatible-provider"

// Enhanced usage interface to support Groq's cached token fields
interface GroqUsage extends OpenAI.CompletionUsage {
	prompt_tokens_details?: {
		cached_tokens?: number
	}
}

export class GroqHandler extends BaseOpenAiCompatibleProvider<GroqModelId> {
	constructor(options: ApiHandlerOptions) {
		super({
			...options,
			providerName: "Groq",
			baseURL: "https://api.groq.com/openai/v1",
			apiKey: options.groqApiKey,
			defaultProviderModelId: groqDefaultModelId,
			providerModels: groqModels,
			defaultTemperature: 0.5,
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

			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			if (chunk.usage) {
				yield* this.yieldUsage(chunk.usage as GroqUsage)
			}
		}
	}

	private async *yieldUsage(usage: GroqUsage | undefined): ApiStream {
		const { info } = this.getModel()
		const inputTokens = usage?.prompt_tokens || 0
		const outputTokens = usage?.completion_tokens || 0

		const cacheReadTokens = usage?.prompt_tokens_details?.cached_tokens || 0

		// Groq does not track cache writes
		const cacheWriteTokens = 0

		// Calculate cost using OpenAI-compatible cost calculation
		const totalCost = calculateApiCostOpenAI(info, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens)

		yield {
			type: "usage",
			inputTokens,
			outputTokens,
			cacheWriteTokens,
			cacheReadTokens,
			totalCost,
		}
	}
}
