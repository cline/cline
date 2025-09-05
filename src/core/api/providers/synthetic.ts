import { Anthropic } from "@anthropic-ai/sdk"
import { ModelInfo, openAiModelInfoSaneDefaults } from "@shared/api"
import OpenAI from "openai"
import { ApiHandler, CommonApiHandlerOptions } from "../index"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { convertToR1Format } from "../transform/r1-format"
import { ApiStream } from "../transform/stream"

interface SyntheticHandlerOptions extends CommonApiHandlerOptions {
	syntheticApiKey?: string
	syntheticModelId?: string
}

export class SyntheticHandler implements ApiHandler {
	private options: SyntheticHandlerOptions
	private client: OpenAI | undefined

	constructor(options: SyntheticHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.syntheticApiKey) {
				throw new Error("Synthetic API key is required")
			}
			try {
				this.client = new OpenAI({
					baseURL: "https://api.synthetic.new/v1",
					apiKey: this.options.syntheticApiKey,
				})
			} catch (error: any) {
				throw new Error(`Error creating Synthetic client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const client = this.ensureClient()
		const modelId = this.options.syntheticModelId ?? ""
		const isDeepseekReasoner = modelId.includes("DeepSeek-R1")

		let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		if (isDeepseekReasoner) {
			openAiMessages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
		}

		const stream = await client.chat.completions.create({
			model: modelId,
			messages: openAiMessages,
			temperature: 0,
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
				}
			}
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		return {
			id: this.options.syntheticModelId ?? "",
			info: openAiModelInfoSaneDefaults,
		}
	}
}
