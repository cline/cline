import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { ApiHandlerOptions, ModelInfo, openAiModelInfoSaneDefaults } from "../../shared/api"
import { ApiHandler } from "../index"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

export class RequestyHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: OpenAI

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new OpenAI({
			baseURL: "https://router.requesty.ai/v1",
			apiKey: this.options.requestyApiKey,
			defaultHeaders: {
				"HTTP-Referer": "https://cline.bot",
				"X-Title": "Cline",
			},
		})
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const modelId = this.options.requestyModelId ?? ""

		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		// @ts-ignore-next-line
		const stream = await this.client.chat.completions.create({
			model: modelId,
			messages: openAiMessages,
			temperature: 0,
			stream: true,
			stream_options: { include_usage: true },
			...(modelId === "openai/o3-mini" ? { reasoning_effort: this.options.o3MiniReasoningEffort || "medium" } : {}),
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

			// Requesty usage includes an extra field for Anthropic use cases.
			// Safely cast the prompt token details section to the appropriate structure.
			interface RequestyUsage extends OpenAI.CompletionUsage {
				prompt_tokens_details?: {
					caching_tokens?: number
					cached_tokens?: number
				}
				total_cost?: number
			}

			if (chunk.usage) {
				const usage = chunk.usage as RequestyUsage
				const inputTokens = usage.prompt_tokens || 0
				const outputTokens = usage.completion_tokens || 0
				const cacheWriteTokens = usage.prompt_tokens_details?.caching_tokens || undefined
				const cacheReadTokens = usage.prompt_tokens_details?.cached_tokens || undefined
				const totalCost = 0 // TODO: Replace with calculateApiCostOpenAI(model.info, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens)

				yield {
					type: "usage",
					inputTokens: inputTokens,
					outputTokens: outputTokens,
					cacheWriteTokens: cacheWriteTokens,
					cacheReadTokens: cacheReadTokens,
					totalCost: totalCost,
				}
			}
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		return {
			id: this.options.requestyModelId ?? "",
			info: openAiModelInfoSaneDefaults,
		}
	}
}
