import { Anthropic } from "@anthropic-ai/sdk"
import axios from "axios"
import delay from "delay"
import OpenAI from "openai"
import { withRetry } from "../retry"
import { ApiHandler } from "../"
import { ApiHandlerOptions, ModelInfo, openRouterDefaultModelId, openRouterDefaultModelInfo } from "../../shared/api"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import { convertToR1Format } from "../transform/r1-format"
import { OpenRouterErrorResponse } from "./types"

export class OpenRouterHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: OpenAI

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new OpenAI({
			baseURL: "https://openrouter.ai/api/v1",
			apiKey: this.options.openRouterApiKey,
			defaultHeaders: {
				"HTTP-Referer": "https://cline.bot", // Optional, for including your app on openrouter.ai rankings.
				"X-Title": "Cline", // Optional. Shows in rankings on openrouter.ai.
			},
		})
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const model = this.getModel()

		// Convert Anthropic messages to OpenAI format
		let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		// prompt caching: https://openrouter.ai/docs/prompt-caching
		// this is specifically for claude models (some models may 'support prompt caching' automatically without this)
		switch (model.id) {
			case "anthropic/claude-3.7-sonnet":
			case "anthropic/claude-3.7-sonnet:beta":
			case "anthropic/claude-3.7-sonnet:thinking":
			case "anthropic/claude-3-7-sonnet":
			case "anthropic/claude-3-7-sonnet:beta":
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
		switch (model.id) {
			case "anthropic/claude-3.7-sonnet":
			case "anthropic/claude-3.7-sonnet:beta":
			case "anthropic/claude-3.7-sonnet:thinking":
			case "anthropic/claude-3-7-sonnet":
			case "anthropic/claude-3-7-sonnet:beta":
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

		let temperature: number | undefined = 0
		let topP: number | undefined = undefined
		if (this.getModel().id.startsWith("deepseek/deepseek-r1") || this.getModel().id === "perplexity/sonar-reasoning") {
			// Recommended values from DeepSeek
			temperature = 0.7
			topP = 0.95
			openAiMessages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
		}

		let reasoning: { max_tokens: number } | undefined = undefined
		switch (model.id) {
			case "anthropic/claude-3.7-sonnet":
			case "anthropic/claude-3.7-sonnet:beta":
			case "anthropic/claude-3.7-sonnet:thinking":
			case "anthropic/claude-3-7-sonnet":
			case "anthropic/claude-3-7-sonnet:beta":
				let budget_tokens = this.options.thinkingBudgetTokens || 0
				const reasoningOn = budget_tokens !== 0 ? true : false
				if (reasoningOn) {
					temperature = undefined // extended thinking does not support non-1 temperature
					reasoning = { max_tokens: budget_tokens }
				}
				break
		}

		// Removes messages in the middle when close to context window limit. Should not be applied to models that support prompt caching since it would continuously break the cache.
		let shouldApplyMiddleOutTransform = !model.info.supportsPromptCache
		// except for deepseek (which we set supportsPromptCache to true for), where because the context window is so small our truncation algo might miss and we should use openrouter's middle-out transform as a fallback to ensure we don't exceed the context window (FIXME: once we have a more robust token estimator we should not rely on this)
		if (model.id === "deepseek/deepseek-chat") {
			shouldApplyMiddleOutTransform = true
		}

		// @ts-ignore-next-line
		const stream = await this.client.chat.completions.create({
			model: model.id,
			max_tokens: maxTokens,
			temperature: temperature,
			top_p: topP,
			messages: openAiMessages,
			stream: true,
			transforms: shouldApplyMiddleOutTransform ? ["middle-out"] : undefined,
			include_reasoning: true,
			...(model.id === "openai/o3-mini" ? { reasoning_effort: this.options.o3MiniReasoningEffort || "medium" } : {}),
			...(reasoning ? { reasoning } : {}),
		})

		let genId: string | undefined

		for await (const chunk of stream) {
			// openrouter returns an error object instead of the openai sdk throwing an error
			if ("error" in chunk) {
				const error = chunk.error as OpenRouterErrorResponse["error"]
				console.error(`OpenRouter API Error: ${error?.code} - ${error?.message}`)
				// Include metadata in the error message if available
				const metadataStr = error.metadata ? `\nMetadata: ${JSON.stringify(error.metadata, null, 2)}` : ""
				throw new Error(`OpenRouter API Error ${error.code}: ${error.message}${metadataStr}`)
			}

			if (!genId && chunk.id) {
				genId = chunk.id
			}

			const delta = chunk.choices[0]?.delta
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			// Reasoning tokens are returned separately from the content
			if ("reasoning" in delta && delta.reasoning) {
				// console.log("reasoning", delta.reasoning)
				yield {
					type: "reasoning",
					// @ts-ignore-next-line
					reasoning: delta.reasoning,
				}

				// if (didStreamThinkTagInReasoning) {
				// 	yield {
				// 		type: "text",
				// 		// @ts-ignore-next-line
				// 		text: delta.reasoning,
				// 	}
				// } else {
				// 	yield {
				// 		type: "reasoning",
				// 		// @ts-ignore-next-line
				// 		text: delta.reasoning,
				// 	}

				// 	// @ts-ignore-next-line
				// 	reasoningResponse += delta.reasoning
				// 	if (reasoningResponse.includes("</think>")) {
				// 		didStreamThinkTagInReasoning = true
				// 		console.log("did hit think tag", reasoningResponse)
				// 	}
				// }
			}
			// if (chunk.usage) {
			// 	yield {
			// 		type: "usage",
			// 		inputTokens: chunk.usage.prompt_tokens || 0,
			// 		outputTokens: chunk.usage.completion_tokens || 0,
			// 	}
			// }
		}

		if (genId) {
			await delay(500) // FIXME: necessary delay to ensure generation endpoint is ready
			try {
				const generationIterator = this.fetchGenerationDetails(genId)
				const generation = (await generationIterator.next()).value
				// console.log("OpenRouter generation details:", generation)
				yield {
					type: "usage",
					// cacheWriteTokens: 0,
					// cacheReadTokens: 0,
					// openrouter generation endpoint fails often
					inputTokens: generation?.native_tokens_prompt || 0,
					outputTokens: generation?.native_tokens_completion || 0,
					totalCost: generation?.total_cost || 0,
				}
			} catch (error) {
				// ignore if fails
				console.error("Error fetching OpenRouter generation details:", error)
			}
		}
	}

	@withRetry({ maxRetries: 4, baseDelay: 250, maxDelay: 1000, retryAllErrors: true })
	async *fetchGenerationDetails(genId: string) {
		// console.log("Fetching generation details for:", genId)
		try {
			const response = await axios.get(`https://openrouter.ai/api/v1/generation?id=${genId}`, {
				headers: {
					Authorization: `Bearer ${this.options.openRouterApiKey}`,
				},
				timeout: 5_000, // this request hangs sometimes
			})
			yield response.data?.data
		} catch (error) {
			// ignore if fails
			console.error("Error fetching OpenRouter generation details:", error)
			throw error
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
}
