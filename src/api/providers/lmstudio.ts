import type { Anthropic } from "@anthropic-ai/sdk"
import { type ModelInfo, openAiModelInfoSaneDefaults } from "@shared/api"
import OpenAI from "openai"
import type { ApiHandler } from "../"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import type { ApiStream } from "../transform/stream"

interface LmStudioHandlerOptions {
	lmStudioBaseUrl?: string
	lmStudioModelId?: string
	lmStudioMaxTokens?: string
}

export class LmStudioHandler implements ApiHandler {
	private options: LmStudioHandlerOptions
	private client: OpenAI | undefined

	constructor(options: LmStudioHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			try {
				this.client = new OpenAI({
					baseURL: new URL("v1", this.options.lmStudioBaseUrl || "http://localhost:1234").toString(),
					apiKey: "noop",
				})
			} catch (error) {
				throw new Error(`Error creating LM Studio client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry({ retryAllErrors: true })
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const client = this.ensureClient()
		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		try {
			const stream = await client.chat.completions.create({
				model: this.getModel().id,
				messages: openAiMessages,
				stream: true,
				max_completion_tokens: this.options.lmStudioMaxTokens ? Number(this.options.lmStudioMaxTokens) : undefined,
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
			}
		} catch {
			// LM Studio doesn't return an error code/body for now
			throw new Error(
				"Please check the LM Studio developer logs to debug what went wrong. You may need to load the model with a larger context length to work with Cline's prompts.",
			)
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
