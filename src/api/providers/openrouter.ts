import { Anthropic } from "@anthropic-ai/sdk"
import axios from "axios"
import OpenAI from "openai"
import { ApiHandler } from "../"
import {
	ApiHandlerOptions,
	ModelInfo,
	openRouterDefaultModelId,
	OpenRouterModelId,
	openRouterModels,
} from "../../shared/api"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

export class OpenRouterHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: OpenAI

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new OpenAI({
			baseURL: "https://openrouter.ai/api/v1",
			apiKey: this.options.openRouterApiKey,
			defaultHeaders: {
				"HTTP-Referer": "https://github.com/saoudrizwan/claude-dev", // Optional, for including your app on openrouter.ai rankings.
				"X-Title": "claude-dev", // Optional. Shows in rankings on openrouter.ai.
			},
		})
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		// Convert Anthropic messages to OpenAI format
		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		// prompt caching: https://openrouter.ai/docs/prompt-caching
		switch (this.getModel().id) {
			case "anthropic/claude-3.5-sonnet:beta":
			case "anthropic/claude-3-haiku:beta":
			case "anthropic/claude-3-opus:beta":
				openAiMessages[0] = {
					role: "system",
					content: [
						{
							type: "text",
							text: systemPrompt,
							// @ts-ignore-next-line
							cache_control: { type: "ephemeral" },
						},
					],
				}
				// Add cache_control to the last two user messages
				const lastTwoUserMessages = openAiMessages.filter((msg) => msg.role === "user").slice(-2)
				lastTwoUserMessages.forEach((msg) => {
					if (typeof msg.content === "string") {
						msg.content = [{ type: "text", text: msg.content }]
					}
					if (Array.isArray(msg.content)) {
						let lastTextPart = msg.content.filter((part) => part.type === "text").pop()

						if (!lastTextPart) {
							lastTextPart = { type: "text", text: "..." }
							msg.content.push(lastTextPart)
						}
						// @ts-ignore-next-line
						lastTextPart["cache_control"] = { type: "ephemeral" }
					}
				})
				break
			default:
				break
		}

		const stream = await this.client.chat.completions.create({
			model: this.getModel().id,
			max_tokens: this.getModel().info.maxTokens,
			temperature: 0,
			messages: openAiMessages,
			stream: true,
		})

		let genId: string | undefined

		console.log("Starting stream processing for OpenRouter")
		for await (const chunk of stream) {
			console.log("Received chunk:", chunk)
			// openrouter returns an error object instead of the openai sdk throwing an error
			if ("error" in chunk) {
				const error = chunk.error as { message?: string; code?: number }
				console.error(`OpenRouter API Error: ${error?.code} - ${error?.message}`)
				throw new Error(`OpenRouter API Error ${error?.code}: ${error?.message}`)
			}

			if (!genId && chunk.id) {
				genId = chunk.id
				console.log("Generation ID set:", genId)
			}

			const delta = chunk.choices[0]?.delta
			if (delta?.content) {
				console.log("Yielding content:", delta.content)
				yield {
					type: "text",
					text: delta.content,
				}
			}
		}
		console.log("Stream processing completed")

		try {
			console.log("Fetching generation details for ID:", genId)
			const response = await axios.get(`https://openrouter.ai/api/v1/generation?id=${genId}`, {
				headers: {
					Authorization: `Bearer ${this.options.openRouterApiKey}`,
				},
			})

			const generation = response.data?.data
			console.log("OpenRouter generation details:", response.data)
			console.log("Yielding usage information")
			yield {
				type: "usage",
				inputTokens: generation?.native_tokens_prompt || 0,
				outputTokens: generation?.native_tokens_completion || 0,
				// cacheWriteTokens: 0,
				// cacheReadTokens: 0,
				totalCost: generation?.total_cost || 0,
			}
		} catch (error) {
			// ignore if fails
			console.error("Error fetching OpenRouter generation details:", error)
		}
	}

	getModel(): { id: OpenRouterModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in openRouterModels) {
			const id = modelId as OpenRouterModelId
			return { id, info: openRouterModels[id] }
		}
		return { id: openRouterDefaultModelId, info: openRouterModels[openRouterDefaultModelId] }
	}
}
