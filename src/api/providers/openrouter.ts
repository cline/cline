import { Anthropic } from "@anthropic-ai/sdk"
import axios from "axios"
import OpenAI from "openai"
import { ApiHandler } from "../"
import { ApiHandlerOptions, ModelInfo, openRouterDefaultModelId, openRouterDefaultModelInfo } from "../../shared/api"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStreamChunk, ApiStreamUsageChunk } from "../transform/stream"
import delay from "delay"

// Add custom interface for OpenRouter params
type OpenRouterChatCompletionParams = OpenAI.Chat.ChatCompletionCreateParams & {
	transforms?: string[]
	include_reasoning?: boolean
}

// Add custom interface for OpenRouter usage chunk
interface OpenRouterApiStreamUsageChunk extends ApiStreamUsageChunk {
	fullResponseText: string
}

import { SingleCompletionHandler } from ".."
import { convertToR1Format } from "../transform/r1-format"

export class OpenRouterHandler implements ApiHandler, SingleCompletionHandler {
	private options: ApiHandlerOptions
	private client: OpenAI

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new OpenAI({
			baseURL: this.options.openRouterBaseUrl || "https://openrouter.ai/api/v1",
			apiKey: this.options.openRouterApiKey,
			defaultHeaders: {
				"HTTP-Referer": "https://github.com/RooVetGit/Roo-Cline",
				"X-Title": "Roo Code",
			},
		})
	}

	async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
	): AsyncGenerator<ApiStreamChunk> {
		// Convert Anthropic messages to OpenAI format
		let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		// prompt caching: https://openrouter.ai/docs/prompt-caching
		// this is specifically for claude models (some models may 'support prompt caching' automatically without this)
		switch (this.getModel().id) {
			case "anthropic/claude-3.5-sonnet":
			case "anthropic/claude-3.5-sonnet:beta":
			case "anthropic/claude-3.5-sonnet-20240620":
			case "anthropic/claude-3.5-sonnet-20240620:beta":
			case "anthropic/claude-3-5-haiku":
			case "anthropic/claude-3-5-haiku:beta":
			case "anthropic/claude-3-5-haiku-20241022":
			case "anthropic/claude-3-5-haiku-20241022:beta":
			case "anthropic/claude-3-haiku":
			case "anthropic/claude-3-haiku:beta":
			case "anthropic/claude-3-opus":
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
				// (note: this works because we only ever add one user message at a time, but if we added multiple we'd need to mark the user message before the last assistant message)
				const lastTwoUserMessages = openAiMessages.filter((msg) => msg.role === "user").slice(-2)
				lastTwoUserMessages.forEach((msg) => {
					if (typeof msg.content === "string") {
						msg.content = [{ type: "text", text: msg.content }]
					}
					if (Array.isArray(msg.content)) {
						// NOTE: this is fine since env details will always be added at the end. but if it weren't there, and the user added a image_url type message, it would pop a text part before it and then move it after to the end.
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

		// Not sure how openrouter defaults max tokens when no value is provided, but the anthropic api requires this value and since they offer both 4096 and 8192 variants, we should ensure 8192.
		// (models usually default to max tokens allowed)
		let maxTokens: number | undefined
		switch (this.getModel().id) {
			case "anthropic/claude-3.5-sonnet":
			case "anthropic/claude-3.5-sonnet:beta":
			case "anthropic/claude-3.5-sonnet-20240620":
			case "anthropic/claude-3.5-sonnet-20240620:beta":
			case "anthropic/claude-3-5-haiku":
			case "anthropic/claude-3-5-haiku:beta":
			case "anthropic/claude-3-5-haiku-20241022":
			case "anthropic/claude-3-5-haiku-20241022:beta":
				maxTokens = 8_192
				break
		}

		let temperature = 0
		switch (this.getModel().id) {
			case "deepseek/deepseek-r1":
				// Recommended temperature for DeepSeek reasoning models
				temperature = 0.6
				// DeepSeek highly recommends using user instead of system role
				openAiMessages[0].role = "user"
				openAiMessages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
		}

		// https://openrouter.ai/docs/transforms
		let fullResponseText = ""
		const stream = await this.client.chat.completions.create({
			model: this.getModel().id,
			max_tokens: maxTokens,
			temperature: temperature,
			messages: openAiMessages,
			stream: true,
			include_reasoning: true,
			// This way, the transforms field will only be included in the parameters when openRouterUseMiddleOutTransform is true.
			...(this.options.openRouterUseMiddleOutTransform && { transforms: ["middle-out"] }),
		} as OpenRouterChatCompletionParams)

		let genId: string | undefined

		for await (const chunk of stream as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>) {
			// openrouter returns an error object instead of the openai sdk throwing an error
			if ("error" in chunk) {
				const error = chunk.error as { message?: string; code?: number }
				console.error(`OpenRouter API Error: ${error?.code} - ${error?.message}`)
				throw new Error(`OpenRouter API Error ${error?.code}: ${error?.message}`)
			}

			if (!genId && chunk.id) {
				genId = chunk.id
			}

			const delta = chunk.choices[0]?.delta
			if ("reasoning" in delta && delta.reasoning) {
				yield {
					type: "reasoning",
					text: delta.reasoning,
				} as ApiStreamChunk
			}
			if (delta?.content) {
				fullResponseText += delta.content
				yield {
					type: "text",
					text: delta.content,
				} as ApiStreamChunk
			}
			// if (chunk.usage) {
			// 	yield {
			// 		type: "usage",
			// 		inputTokens: chunk.usage.prompt_tokens || 0,
			// 		outputTokens: chunk.usage.completion_tokens || 0,
			// 	}
			// }
		}

		await delay(500) // FIXME: necessary delay to ensure generation endpoint is ready

		try {
			const response = await axios.get(`https://openrouter.ai/api/v1/generation?id=${genId}`, {
				headers: {
					Authorization: `Bearer ${this.options.openRouterApiKey}`,
				},
				timeout: 5_000, // this request hangs sometimes
			})

			const generation = response.data?.data
			console.log("OpenRouter generation details:", response.data)
			yield {
				type: "usage",
				// cacheWriteTokens: 0,
				// cacheReadTokens: 0,
				// openrouter generation endpoint fails often
				inputTokens: generation?.native_tokens_prompt || 0,
				outputTokens: generation?.native_tokens_completion || 0,
				totalCost: generation?.total_cost || 0,
				fullResponseText,
			} as OpenRouterApiStreamUsageChunk
		} catch (error) {
			// ignore if fails
			console.error("Error fetching OpenRouter generation details:", error)
		}
	}
	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.openRouterModelId
		const modelInfo = this.options.openRouterModelInfo
		if (modelId && modelInfo) {
			return { id: modelId, info: modelInfo }
		}
		return { id: openRouterDefaultModelId, info: openRouterDefaultModelInfo }
	}

	async completePrompt(prompt: string): Promise<string> {
		try {
			const response = await this.client.chat.completions.create({
				model: this.getModel().id,
				messages: [{ role: "user", content: prompt }],
				temperature: 0,
				stream: false,
			})

			if ("error" in response) {
				const error = response.error as { message?: string; code?: number }
				throw new Error(`OpenRouter API Error ${error?.code}: ${error?.message}`)
			}

			const completion = response as OpenAI.Chat.ChatCompletion
			return completion.choices[0]?.message?.content || ""
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`OpenRouter completion error: ${error.message}`)
			}
			throw error
		}
	}
}
