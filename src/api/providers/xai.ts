import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { ApiHandlerOptions, XAIModelId, xaiDefaultModelId, xaiModels, REASONING_MODELS } from "../../shared/api"
import { ApiStream } from "../transform/stream"
import { convertToOpenAiMessages } from "../transform/openai-format"

import { SingleCompletionHandler } from "../index"
import { DEFAULT_HEADERS } from "./constants"
import { BaseProvider } from "./base-provider"

const XAI_DEFAULT_TEMPERATURE = 0

export class XAIHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	private client: OpenAI

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options
		this.client = new OpenAI({
			baseURL: "https://api.x.ai/v1",
			apiKey: this.options.xaiApiKey ?? "not-provided",
			defaultHeaders: DEFAULT_HEADERS,
		})
	}

	override getModel() {
		// Determine which model ID to use (specified or default)
		const id =
			this.options.apiModelId && this.options.apiModelId in xaiModels
				? (this.options.apiModelId as XAIModelId)
				: xaiDefaultModelId

		// Check if reasoning effort applies to this model
		const supportsReasoning = REASONING_MODELS.has(id)

		return {
			id,
			info: xaiModels[id],
			reasoningEffort: supportsReasoning ? this.options.reasoningEffort : undefined,
		}
	}

	override async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const { id: modelId, info: modelInfo, reasoningEffort } = this.getModel()

		// Use the OpenAI-compatible API.
		const stream = await this.client.chat.completions.create({
			model: modelId,
			max_tokens: modelInfo.maxTokens,
			temperature: this.options.modelTemperature ?? XAI_DEFAULT_TEMPERATURE,
			messages: [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
			stream: true,
			stream_options: { include_usage: true },
			...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
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
					text: delta.reasoning_content as string,
				}
			}

			if (chunk.usage) {
				yield {
					type: "usage",
					inputTokens: chunk.usage.prompt_tokens || 0,
					outputTokens: chunk.usage.completion_tokens || 0,
					// X.AI might include these fields in the future, handle them if present.
					cacheReadTokens:
						"cache_read_input_tokens" in chunk.usage ? (chunk.usage as any).cache_read_input_tokens : 0,
					cacheWriteTokens:
						"cache_creation_input_tokens" in chunk.usage
							? (chunk.usage as any).cache_creation_input_tokens
							: 0,
				}
			}
		}
	}

	async completePrompt(prompt: string): Promise<string> {
		const { id: modelId, reasoningEffort } = this.getModel()

		try {
			const response = await this.client.chat.completions.create({
				model: modelId,
				messages: [{ role: "user", content: prompt }],
				...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
			})

			return response.choices[0]?.message.content || ""
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`xAI completion error: ${error.message}`)
			}

			throw error
		}
	}
}
