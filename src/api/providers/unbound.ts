import { Anthropic } from "@anthropic-ai/sdk"
import axios from "axios"
import OpenAI from "openai"

import { ApiHandlerOptions, ModelInfo, unboundDefaultModelId, unboundDefaultModelInfo } from "../../shared/api"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { SingleCompletionHandler } from "../"
import { BaseProvider } from "./base-provider"

interface UnboundUsage extends OpenAI.CompletionUsage {
	cache_creation_input_tokens?: number
	cache_read_input_tokens?: number
}

export class UnboundHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	private client: OpenAI

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options
		const baseURL = "https://api.getunbound.ai/v1"
		const apiKey = this.options.unboundApiKey ?? "not-provided"
		this.client = new OpenAI({ baseURL, apiKey })
	}

	private supportsTemperature(): boolean {
		return !this.getModel().id.startsWith("openai/o3-mini")
	}

	override async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		// Convert Anthropic messages to OpenAI format
		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		// this is specifically for claude models (some models may 'support prompt caching' automatically without this)
		if (this.getModel().id.startsWith("anthropic/claude-3")) {
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
			// (note: this works because we only ever add one user message at a time,
			// but if we added multiple we'd need to mark the user message before the last assistant message)
			const lastTwoUserMessages = openAiMessages.filter((msg) => msg.role === "user").slice(-2)
			lastTwoUserMessages.forEach((msg) => {
				if (typeof msg.content === "string") {
					msg.content = [{ type: "text", text: msg.content }]
				}
				if (Array.isArray(msg.content)) {
					// NOTE: this is fine since env details will always be added at the end.
					// but if it weren't there, and the user added a image_url type message,
					// it would pop a text part before it and then move it after to the end.
					let lastTextPart = msg.content.filter((part) => part.type === "text").pop()

					if (!lastTextPart) {
						lastTextPart = { type: "text", text: "..." }
						msg.content.push(lastTextPart)
					}
					// @ts-ignore-next-line
					lastTextPart["cache_control"] = { type: "ephemeral" }
				}
			})
		}

		// Required by Anthropic
		// Other providers default to max tokens allowed.
		let maxTokens: number | undefined

		if (this.getModel().id.startsWith("anthropic/")) {
			maxTokens = this.getModel().info.maxTokens ?? undefined
		}

		const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
			model: this.getModel().id.split("/")[1],
			max_tokens: maxTokens,
			messages: openAiMessages,
			stream: true,
		}

		if (this.supportsTemperature()) {
			requestOptions.temperature = this.options.modelTemperature ?? 0
		}

		const { data: completion, response } = await this.client.chat.completions
			.create(requestOptions, {
				headers: {
					"X-Unbound-Metadata": JSON.stringify({
						labels: [
							{
								key: "app",
								value: "roo-code",
							},
						],
					}),
				},
			})
			.withResponse()

		for await (const chunk of completion) {
			const delta = chunk.choices[0]?.delta
			const usage = chunk.usage as UnboundUsage

			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			if (usage) {
				const usageData: ApiStreamUsageChunk = {
					type: "usage",
					inputTokens: usage.prompt_tokens || 0,
					outputTokens: usage.completion_tokens || 0,
				}

				// Only add cache tokens if they exist
				if (usage.cache_creation_input_tokens) {
					usageData.cacheWriteTokens = usage.cache_creation_input_tokens
				}
				if (usage.cache_read_input_tokens) {
					usageData.cacheReadTokens = usage.cache_read_input_tokens
				}

				yield usageData
			}
		}
	}

	override getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.unboundModelId
		const modelInfo = this.options.unboundModelInfo
		if (modelId && modelInfo) {
			return { id: modelId, info: modelInfo }
		}
		return {
			id: unboundDefaultModelId,
			info: unboundDefaultModelInfo,
		}
	}

	async completePrompt(prompt: string): Promise<string> {
		try {
			const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
				model: this.getModel().id.split("/")[1],
				messages: [{ role: "user", content: prompt }],
			}

			if (this.supportsTemperature()) {
				requestOptions.temperature = this.options.modelTemperature ?? 0
			}

			if (this.getModel().id.startsWith("anthropic/")) {
				requestOptions.max_tokens = this.getModel().info.maxTokens
			}

			const response = await this.client.chat.completions.create(requestOptions, {
				headers: {
					"X-Unbound-Metadata": JSON.stringify({
						labels: [
							{
								key: "app",
								value: "roo-code",
							},
						],
					}),
				},
			})
			return response.choices[0]?.message.content || ""
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`Unbound completion error: ${error.message}`)
			}
			throw error
		}
	}
}

export async function getUnboundModels() {
	const models: Record<string, ModelInfo> = {}

	try {
		const response = await axios.get("https://api.getunbound.ai/models")

		if (response.data) {
			const rawModels: Record<string, any> = response.data

			for (const [modelId, model] of Object.entries(rawModels)) {
				const modelInfo: ModelInfo = {
					maxTokens: model?.maxTokens ? parseInt(model.maxTokens) : undefined,
					contextWindow: model?.contextWindow ? parseInt(model.contextWindow) : 0,
					supportsImages: model?.supportsImages ?? false,
					supportsPromptCache: model?.supportsPromptCaching ?? false,
					supportsComputerUse: model?.supportsComputerUse ?? false,
					inputPrice: model?.inputTokenPrice ? parseFloat(model.inputTokenPrice) : undefined,
					outputPrice: model?.outputTokenPrice ? parseFloat(model.outputTokenPrice) : undefined,
					cacheWritesPrice: model?.cacheWritePrice ? parseFloat(model.cacheWritePrice) : undefined,
					cacheReadsPrice: model?.cacheReadPrice ? parseFloat(model.cacheReadPrice) : undefined,
				}

				switch (true) {
					case modelId.startsWith("anthropic/"):
						// Set max tokens to 8192 for supported Anthropic models
						if (modelInfo.maxTokens !== 4096) {
							modelInfo.maxTokens = 8192
						}
						break
					default:
						break
				}

				models[modelId] = modelInfo
			}
		}
	} catch (error) {
		console.error(`Error fetching Unbound models: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`)
	}

	return models
}
