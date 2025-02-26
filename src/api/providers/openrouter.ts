import { Anthropic } from "@anthropic-ai/sdk"
import { BetaThinkingConfigParam } from "@anthropic-ai/sdk/resources/beta"
import axios from "axios"
import OpenAI from "openai"
import delay from "delay"

import { ApiHandlerOptions, ModelInfo, openRouterDefaultModelId, openRouterDefaultModelInfo } from "../../shared/api"
import { parseApiPrice } from "../../utils/cost"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStreamChunk, ApiStreamUsageChunk } from "../transform/stream"
import { convertToR1Format } from "../transform/r1-format"
import { DEEP_SEEK_DEFAULT_TEMPERATURE } from "./openai"
import { ApiHandler, SingleCompletionHandler } from ".."

const OPENROUTER_DEFAULT_TEMPERATURE = 0

// Add custom interface for OpenRouter params.
type OpenRouterChatCompletionParams = OpenAI.Chat.ChatCompletionCreateParams & {
	transforms?: string[]
	include_reasoning?: boolean
	thinking?: BetaThinkingConfigParam
}

// Add custom interface for OpenRouter usage chunk.
interface OpenRouterApiStreamUsageChunk extends ApiStreamUsageChunk {
	fullResponseText: string
}

export class OpenRouterHandler implements ApiHandler, SingleCompletionHandler {
	private options: ApiHandlerOptions
	private client: OpenAI

	constructor(options: ApiHandlerOptions) {
		this.options = options

		const baseURL = this.options.openRouterBaseUrl || "https://openrouter.ai/api/v1"
		const apiKey = this.options.openRouterApiKey ?? "not-provided"

		const defaultHeaders = {
			"HTTP-Referer": "https://github.com/RooVetGit/Roo-Cline",
			"X-Title": "Roo Code",
		}

		this.client = new OpenAI({ baseURL, apiKey, defaultHeaders })
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

		const { id: modelId, info: modelInfo } = this.getModel()

		// prompt caching: https://openrouter.ai/docs/prompt-caching
		// this is specifically for claude models (some models may 'support prompt caching' automatically without this)
		switch (true) {
			case modelId.startsWith("anthropic/"):
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

		let defaultTemperature = OPENROUTER_DEFAULT_TEMPERATURE
		let topP: number | undefined = undefined

		// Handle models based on deepseek-r1
		if (modelId.startsWith("deepseek/deepseek-r1") || modelId === "perplexity/sonar-reasoning") {
			// Recommended temperature for DeepSeek reasoning models
			defaultTemperature = DEEP_SEEK_DEFAULT_TEMPERATURE
			// DeepSeek highly recommends using user instead of system role
			openAiMessages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
			// Some provider support topP and 0.95 is value that Deepseek used in their benchmarks
			topP = 0.95
		}

		const maxTokens = this.options.modelMaxTokens || modelInfo.maxTokens
		let temperature = this.options.modelTemperature ?? defaultTemperature
		let thinking: BetaThinkingConfigParam | undefined = undefined

		if (modelInfo.thinking) {
			// Clamp the thinking budget to be at most 80% of max tokens and at
			// least 1024 tokens.
			const maxBudgetTokens = Math.floor((maxTokens || 8192) * 0.8)
			const budgetTokens = Math.max(
				Math.min(this.options.anthropicThinking ?? maxBudgetTokens, maxBudgetTokens),
				1024,
			)

			thinking = { type: "enabled", budget_tokens: budgetTokens }
			temperature = 1.0
		}

		// https://openrouter.ai/docs/transforms
		let fullResponseText = ""

		const completionParams: OpenRouterChatCompletionParams = {
			model: modelId,
			max_tokens: modelInfo.maxTokens,
			temperature,
			thinking, // OpenRouter is temporarily supporting this.
			top_p: topP,
			messages: openAiMessages,
			stream: true,
			include_reasoning: true,
			// This way, the transforms field will only be included in the parameters when openRouterUseMiddleOutTransform is true.
			...(this.options.openRouterUseMiddleOutTransform && { transforms: ["middle-out"] }),
		}

		const stream = await this.client.chat.completions.create(completionParams)

		let genId: string | undefined

		for await (const chunk of stream as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>) {
			// OpenRouter returns an error object instead of the OpenAI SDK throwing an error.
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

		// Retry fetching generation details.
		let attempt = 0

		while (attempt++ < 10) {
			await delay(200) // FIXME: necessary delay to ensure generation endpoint is ready

			try {
				const response = await axios.get(`https://openrouter.ai/api/v1/generation?id=${genId}`, {
					headers: {
						Authorization: `Bearer ${this.options.openRouterApiKey}`,
					},
					timeout: 5_000, // this request hangs sometimes
				})

				const generation = response.data?.data

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

				return
			} catch (error) {
				// ignore if fails
				console.error("Error fetching OpenRouter generation details:", error)
			}
		}
	}

	getModel() {
		const modelId = this.options.openRouterModelId
		const modelInfo = this.options.openRouterModelInfo
		return modelId && modelInfo
			? { id: modelId, info: modelInfo }
			: { id: openRouterDefaultModelId, info: openRouterDefaultModelInfo }
	}

	async completePrompt(prompt: string): Promise<string> {
		try {
			const response = await this.client.chat.completions.create({
				model: this.getModel().id,
				messages: [{ role: "user", content: prompt }],
				temperature: this.options.modelTemperature ?? OPENROUTER_DEFAULT_TEMPERATURE,
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

export async function getOpenRouterModels() {
	const models: Record<string, ModelInfo> = {}

	try {
		const response = await axios.get("https://openrouter.ai/api/v1/models")
		const rawModels = response.data.data

		for (const rawModel of rawModels) {
			const modelInfo: ModelInfo = {
				maxTokens: rawModel.top_provider?.max_completion_tokens,
				contextWindow: rawModel.context_length,
				supportsImages: rawModel.architecture?.modality?.includes("image"),
				supportsPromptCache: false,
				inputPrice: parseApiPrice(rawModel.pricing?.prompt),
				outputPrice: parseApiPrice(rawModel.pricing?.completion),
				description: rawModel.description,
				thinking: rawModel.id === "anthropic/claude-3.7-sonnet:thinking",
			}

			// NOTE: this needs to be synced with api.ts/openrouter default model info.
			switch (true) {
				case rawModel.id.startsWith("anthropic/claude-3.7-sonnet"):
					modelInfo.supportsComputerUse = true
					modelInfo.supportsPromptCache = true
					modelInfo.cacheWritesPrice = 3.75
					modelInfo.cacheReadsPrice = 0.3
					modelInfo.maxTokens = 64_000
					break
				case rawModel.id.startsWith("anthropic/claude-3.5-sonnet-20240620"):
					modelInfo.supportsPromptCache = true
					modelInfo.cacheWritesPrice = 3.75
					modelInfo.cacheReadsPrice = 0.3
					modelInfo.maxTokens = 8192
					break
				case rawModel.id.startsWith("anthropic/claude-3.5-sonnet"):
					modelInfo.supportsComputerUse = true
					modelInfo.supportsPromptCache = true
					modelInfo.cacheWritesPrice = 3.75
					modelInfo.cacheReadsPrice = 0.3
					modelInfo.maxTokens = 8192
					break
				case rawModel.id.startsWith("anthropic/claude-3-5-haiku"):
					modelInfo.supportsPromptCache = true
					modelInfo.cacheWritesPrice = 1.25
					modelInfo.cacheReadsPrice = 0.1
					modelInfo.maxTokens = 8192
					break
				case rawModel.id.startsWith("anthropic/claude-3-opus"):
					modelInfo.supportsPromptCache = true
					modelInfo.cacheWritesPrice = 18.75
					modelInfo.cacheReadsPrice = 1.5
					modelInfo.maxTokens = 8192
					break
				case rawModel.id.startsWith("anthropic/claude-3-haiku"):
				default:
					modelInfo.supportsPromptCache = true
					modelInfo.cacheWritesPrice = 0.3
					modelInfo.cacheReadsPrice = 0.03
					modelInfo.maxTokens = 8192
					break
			}

			models[rawModel.id] = modelInfo
		}
	} catch (error) {
		console.error(
			`Error fetching OpenRouter models: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
		)
	}

	return models
}
