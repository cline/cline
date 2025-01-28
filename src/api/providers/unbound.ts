import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { ApiHandler, SingleCompletionHandler } from "../"
import { ApiHandlerOptions, ModelInfo, UnboundModelId, unboundDefaultModelId, unboundModels } from "../../shared/api"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

export class UnboundHandler implements ApiHandler, SingleCompletionHandler {
	private options: ApiHandlerOptions
	private client: OpenAI

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new OpenAI({
			baseURL: "https://api.getunbound.ai/v1",
			apiKey: this.options.unboundApiKey,
		})
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
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
			maxTokens = 8_192
		}

		const { data: completion, response } = await this.client.chat.completions
			.create(
				{
					model: this.getModel().id.split("/")[1],
					max_tokens: maxTokens,
					temperature: 0,
					messages: openAiMessages,
					stream: true,
				},
				{
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
				},
			)
			.withResponse()

		for await (const chunk of completion) {
			const delta = chunk.choices[0]?.delta
			const usage = chunk.usage

			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			if (usage) {
				yield {
					type: "usage",
					inputTokens: usage?.prompt_tokens || 0,
					outputTokens: usage?.completion_tokens || 0,
				}
			}
		}
	}

	getModel(): { id: UnboundModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in unboundModels) {
			const id = modelId as UnboundModelId
			return { id, info: unboundModels[id] }
		}
		return {
			id: unboundDefaultModelId,
			info: unboundModels[unboundDefaultModelId],
		}
	}

	async completePrompt(prompt: string): Promise<string> {
		try {
			const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
				model: this.getModel().id.split("/")[1],
				messages: [{ role: "user", content: prompt }],
				temperature: 0,
			}

			if (this.getModel().id.startsWith("anthropic/")) {
				requestOptions.max_tokens = 8192
			}

			const response = await this.client.chat.completions.create(requestOptions)
			return response.choices[0]?.message.content || ""
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`Unbound completion error: ${error.message}`)
			}
			throw error
		}
	}
}
