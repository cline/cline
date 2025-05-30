import { Anthropic } from "@anthropic-ai/sdk"
import axios from "axios"
import OpenAI from "openai"

import { glamaDefaultModelId, glamaDefaultModelInfo, GLAMA_DEFAULT_TEMPERATURE } from "@roo-code/types"

import { Package } from "../../shared/package"
import { ApiHandlerOptions } from "../../shared/api"

import { ApiStream } from "../transform/stream"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { addCacheBreakpoints } from "../transform/caching/anthropic"

import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { RouterProvider } from "./router-provider"

const DEFAULT_HEADERS = {
	"X-Glama-Metadata": JSON.stringify({
		labels: [{ key: "app", value: `vscode.${Package.publisher}.${Package.name}` }],
	}),
}

export class GlamaHandler extends RouterProvider implements SingleCompletionHandler {
	constructor(options: ApiHandlerOptions) {
		super({
			options,
			name: "glama",
			baseURL: "https://glama.ai/api/gateway/openai/v1",
			apiKey: options.glamaApiKey,
			modelId: options.glamaModelId,
			defaultModelId: glamaDefaultModelId,
			defaultModelInfo: glamaDefaultModelInfo,
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

		if (modelId.startsWith("anthropic/claude-3")) {
			addCacheBreakpoints(systemPrompt, openAiMessages)
		}

		// Required by Anthropic; other providers default to max tokens allowed.
		let maxTokens: number | undefined

		if (modelId.startsWith("anthropic/")) {
			maxTokens = info.maxTokens ?? undefined
		}

		const requestOptions: OpenAI.Chat.ChatCompletionCreateParams = {
			model: modelId,
			max_tokens: maxTokens,
			messages: openAiMessages,
			stream: true,
		}

		if (this.supportsTemperature(modelId)) {
			requestOptions.temperature = this.options.modelTemperature ?? GLAMA_DEFAULT_TEMPERATURE
		}

		const { data: completion, response } = await this.client.chat.completions
			.create(requestOptions, { headers: DEFAULT_HEADERS })
			.withResponse()

		const completionRequestId = response.headers.get("x-completion-request-id")

		for await (const chunk of completion) {
			const delta = chunk.choices[0]?.delta

			if (delta?.content) {
				yield { type: "text", text: delta.content }
			}
		}

		try {
			let attempt = 0

			const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

			while (attempt++ < 10) {
				// In case of an interrupted request, we need to wait for the upstream API to finish processing the request
				// before we can fetch information about the token usage and cost.
				const response = await axios.get(
					`https://glama.ai/api/gateway/v1/completion-requests/${completionRequestId}`,
					{ headers: { Authorization: `Bearer ${this.options.glamaApiKey}` } },
				)

				const completionRequest = response.data

				if (completionRequest.tokenUsage && completionRequest.totalCostUsd) {
					yield {
						type: "usage",
						cacheWriteTokens: completionRequest.tokenUsage.cacheCreationInputTokens,
						cacheReadTokens: completionRequest.tokenUsage.cacheReadInputTokens,
						inputTokens: completionRequest.tokenUsage.promptTokens,
						outputTokens: completionRequest.tokenUsage.completionTokens,
						totalCost: parseFloat(completionRequest.totalCostUsd),
					}

					break
				}

				await delay(200)
			}
		} catch (error) {
			console.error("Error fetching Glama completion details", error)
		}
	}

	async completePrompt(prompt: string): Promise<string> {
		const { id: modelId, info } = await this.fetchModel()

		try {
			const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
				model: modelId,
				messages: [{ role: "user", content: prompt }],
			}

			if (this.supportsTemperature(modelId)) {
				requestOptions.temperature = this.options.modelTemperature ?? GLAMA_DEFAULT_TEMPERATURE
			}

			if (modelId.startsWith("anthropic/")) {
				requestOptions.max_tokens = info.maxTokens
			}

			const response = await this.client.chat.completions.create(requestOptions)
			return response.choices[0]?.message.content || ""
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`Glama completion error: ${error.message}`)
			}

			throw error
		}
	}
}
