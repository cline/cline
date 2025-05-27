import { Anthropic } from "@anthropic-ai/sdk"
import { Mistral } from "@mistralai/mistralai"

import type { ModelInfo } from "@roo-code/types"

import { ApiHandlerOptions, mistralDefaultModelId, MistralModelId, mistralModels } from "../../shared/api"
import { convertToMistralMessages } from "../transform/mistral-format"
import { ApiStream } from "../transform/stream"

import { BaseProvider } from "./base-provider"
import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"

const MISTRAL_DEFAULT_TEMPERATURE = 0

export class MistralHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	private client: Mistral

	constructor(options: ApiHandlerOptions) {
		super()

		if (!options.mistralApiKey) {
			throw new Error("Mistral API key is required")
		}

		// Set default model ID if not provided.
		const apiModelId = options.apiModelId || mistralDefaultModelId
		this.options = { ...options, apiModelId }

		this.client = new Mistral({
			serverURL: apiModelId.startsWith("codestral-")
				? this.options.mistralCodestralUrl || "https://codestral.mistral.ai"
				: "https://api.mistral.ai",
			apiKey: this.options.mistralApiKey,
		})
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const { id: model, maxTokens, temperature } = this.getModel()

		const response = await this.client.chat.stream({
			model,
			messages: [{ role: "system", content: systemPrompt }, ...convertToMistralMessages(messages)],
			maxTokens,
			temperature,
		})

		for await (const chunk of response) {
			const delta = chunk.data.choices[0]?.delta

			if (delta?.content) {
				let content: string = ""

				if (typeof delta.content === "string") {
					content = delta.content
				} else if (Array.isArray(delta.content)) {
					content = delta.content.map((c) => (c.type === "text" ? c.text : "")).join("")
				}

				yield { type: "text", text: content }
			}

			if (chunk.data.usage) {
				yield {
					type: "usage",
					inputTokens: chunk.data.usage.promptTokens || 0,
					outputTokens: chunk.data.usage.completionTokens || 0,
				}
			}
		}
	}

	override getModel() {
		const id = this.options.apiModelId ?? mistralDefaultModelId
		const info = mistralModels[id as MistralModelId] ?? mistralModels[mistralDefaultModelId]

		// @TODO: Move this to the `getModelParams` function.
		const maxTokens = this.options.includeMaxTokens ? info.maxTokens : undefined
		const temperature = this.options.modelTemperature ?? MISTRAL_DEFAULT_TEMPERATURE

		return { id, info, maxTokens, temperature }
	}

	async completePrompt(prompt: string): Promise<string> {
		try {
			const { id: model, temperature } = this.getModel()

			const response = await this.client.chat.complete({
				model,
				messages: [{ role: "user", content: prompt }],
				temperature,
			})

			const content = response.choices?.[0]?.message.content

			if (Array.isArray(content)) {
				return content.map((c) => (c.type === "text" ? c.text : "")).join("")
			}

			return content || ""
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`Mistral completion error: ${error.message}`)
			}

			throw error
		}
	}
}
