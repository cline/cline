import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI, { AzureOpenAI } from "openai"
import { ApiHandlerOptions, azureOpenAiDefaultApiVersion, ModelInfo, openAiModelInfoSaneDefaults } from "../../shared/api"
import { ApiHandler } from "../index"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

export class OpenAiHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: OpenAI

	constructor(options: ApiHandlerOptions) {
		this.options = options
		// Azure API shape slightly differs from the core API shape: https://github.com/openai/openai-node?tab=readme-ov-file#microsoft-azure-openai
		if (this.options.openAiBaseUrl?.toLowerCase().includes("azure.com")) {
			this.client = new AzureOpenAI({
				baseURL: this.options.openAiBaseUrl,
				apiKey: this.options.openAiApiKey,
				apiVersion: this.options.azureApiVersion || azureOpenAiDefaultApiVersion,
			})
		} else {
			this.client = new OpenAI({
				baseURL: this.options.openAiBaseUrl,
				apiKey: this.options.openAiApiKey,
			})
		}
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		// Port prompt caching capability to OpenAI provider
		if (this.options.openAiSupportsPromptCache) {
			// Add cache_control to system message
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
		}

		const stream = await this.client.chat.completions.create({
			model: this.options.openAiModelId ?? "",
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
			if (chunk.usage) {
				// Calculate estimated cache metrics for OpenAI provider
				// This matches the token usage reporting format used by other providers
				let cacheWrites = 0
				let cacheReads = 0
				if (this.options.openAiSupportsPromptCache) {
					// Estimate cache metrics based on input tokens
					// Last two user messages are marked for caching
					const lastTwoUserMessages = openAiMessages.filter((msg) => msg.role === "user").slice(-2)
					if (lastTwoUserMessages.length > 0) {
						// Assume the last message is a cache write and previous is a cache read
						cacheWrites = Math.floor(chunk.usage.prompt_tokens * 0.2) // Estimate 20% of input tokens are cache writes
						cacheReads = Math.floor(chunk.usage.prompt_tokens * 0.1) // Estimate 10% of input tokens are cache reads
					}
				}

				// First yield the usage info with cache metrics
				yield {
					type: "usage",
					inputTokens: chunk.usage.prompt_tokens || 0,
					outputTokens: chunk.usage.completion_tokens || 0,
					cacheWriteTokens: cacheWrites,
					cacheReadTokens: cacheReads,
				}

				if (this.options.openAiSupportsPromptCache) {
					// Include usage and cache metrics in the API request info
					yield {
						type: "text",
						text: JSON.stringify({
							say: "api_req_started",
							request: "API Request",
							usage: {
								inputTokens: chunk.usage.prompt_tokens || 0,
								outputTokens: chunk.usage.completion_tokens || 0,
								cacheWriteTokens: cacheWrites,
								cacheReadTokens: cacheReads,
							},
						}),
					}
				}
			}
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		// Report model capabilities and pricing for OpenAI provider
		// Includes support for computer use and prompt caching if enabled
		const info: ModelInfo = {
			...openAiModelInfoSaneDefaults,
			supportsComputerUse: this.options.openAiSupportsComputerUse ?? false,
			supportsPromptCache: this.options.openAiSupportsPromptCache ?? false,
			// Use standard cache pricing when prompt caching is enabled
			...(this.options.openAiSupportsPromptCache && {
				cacheWritesPrice: 3.75, // Using Anthropic's pricing as an example
				cacheReadsPrice: 0.3,
			}),
		}
		return {
			id: this.options.openAiModelId ?? "",
			info,
		}
	}
}
