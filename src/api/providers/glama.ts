import { Anthropic } from "@anthropic-ai/sdk"
import axios from "axios"
import OpenAI from "openai"

import { ApiHandlerOptions, ModelInfo, glamaDefaultModelId, glamaDefaultModelInfo } from "../../shared/api"
import { parseApiPrice } from "../../utils/cost"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import { SingleCompletionHandler } from "../"
import { BaseProvider } from "./base-provider"

const GLAMA_DEFAULT_TEMPERATURE = 0

export class GlamaHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	private client: OpenAI

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options
		const baseURL = "https://glama.ai/api/gateway/openai/v1"
		const apiKey = this.options.glamaApiKey ?? "not-provided"
		this.client = new OpenAI({ baseURL, apiKey })
	}

	private supportsTemperature(): boolean {
		return !this.getModel().id.startsWith("openai/o3-mini")
	}

	override getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.glamaModelId
		const modelInfo = this.options.glamaModelInfo

		if (modelId && modelInfo) {
			return { id: modelId, info: modelInfo }
		}

		return { id: glamaDefaultModelId, info: glamaDefaultModelInfo }
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

		const requestOptions: OpenAI.Chat.ChatCompletionCreateParams = {
			model: this.getModel().id,
			max_tokens: maxTokens,
			messages: openAiMessages,
			stream: true,
		}

		if (this.supportsTemperature()) {
			requestOptions.temperature = this.options.modelTemperature ?? GLAMA_DEFAULT_TEMPERATURE
		}

		const { data: completion, response } = await this.client.chat.completions
			.create(requestOptions, {
				headers: {
					"X-Glama-Metadata": JSON.stringify({
						labels: [
							{
								key: "app",
								value: "vscode.rooveterinaryinc.roo-cline",
							},
						],
					}),
				},
			})
			.withResponse()

		const completionRequestId = response.headers.get("x-completion-request-id")

		for await (const chunk of completion) {
			const delta = chunk.choices[0]?.delta

			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}
		}

		try {
			let attempt = 0

			const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

			while (attempt++ < 10) {
				// In case of an interrupted request, we need to wait for the upstream API to finish processing the request
				// before we can fetch information about the token usage and cost.
				const response = await axios.get(
					`https://glama.ai/api/gateway/v1/completion-requests/${completionRequestId}`,
					{
						headers: {
							Authorization: `Bearer ${this.options.glamaApiKey}`,
						},
					},
				)

				const completionRequest = response.data

				if (completionRequest.tokenUsage && completionRequest.totalCostUsd) {
					yield {
						type: "usage",
						cacheWriteTokens: completionRequest.tokenUsage.cacheCreationInputTokens,
						cacheReadTokens: completionRequest.tokenUsage.cacheReadInputTokens,
						inputTokens: completionRequest.tokenUsage.promptTokens,
						outputTokens: completionRequest.tokenUsage.completionTokens,
						totalCost: parseFloat(completionRequest.totalCostUsd),
					}

					break
				}

				await delay(200)
			}
		} catch (error) {
			console.error("Error fetching Glama completion details", error)
		}
	}

	async completePrompt(prompt: string): Promise<string> {
		try {
			const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
				model: this.getModel().id,
				messages: [{ role: "user", content: prompt }],
			}

			if (this.supportsTemperature()) {
				requestOptions.temperature = this.options.modelTemperature ?? GLAMA_DEFAULT_TEMPERATURE
			}

			if (this.getModel().id.startsWith("anthropic/")) {
				requestOptions.max_tokens = this.getModel().info.maxTokens
			}

			const response = await this.client.chat.completions.create(requestOptions)
			return response.choices[0]?.message.content || ""
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`Glama completion error: ${error.message}`)
			}
			throw error
		}
	}
}

export async function getGlamaModels() {
	const models: Record<string, ModelInfo> = {}

	try {
		const response = await axios.get("https://glama.ai/api/gateway/v1/models")
		const rawModels = response.data

		for (const rawModel of rawModels) {
			const modelInfo: ModelInfo = {
				maxTokens: rawModel.maxTokensOutput,
				contextWindow: rawModel.maxTokensInput,
				supportsImages: rawModel.capabilities?.includes("input:image"),
				supportsComputerUse: rawModel.capabilities?.includes("computer_use"),
				supportsPromptCache: rawModel.capabilities?.includes("caching"),
				inputPrice: parseApiPrice(rawModel.pricePerToken?.input),
				outputPrice: parseApiPrice(rawModel.pricePerToken?.output),
				description: undefined,
				cacheWritesPrice: parseApiPrice(rawModel.pricePerToken?.cacheWrite),
				cacheReadsPrice: parseApiPrice(rawModel.pricePerToken?.cacheRead),
			}

			switch (rawModel.id) {
				case rawModel.id.startsWith("anthropic/"):
					modelInfo.maxTokens = 8192
					break
				default:
					break
			}

			models[rawModel.id] = modelInfo
		}
	} catch (error) {
		console.error(`Error fetching Glama models: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`)
	}

	return models
}
