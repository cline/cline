import { Anthropic } from "@anthropic-ai/sdk"
import { Mistral } from "@mistralai/mistralai"
import { HTTPClient } from "@mistralai/mistralai/lib/http"
import { Tool as MistralTool } from "@mistralai/mistralai/models/components/tool"
import { MistralModelId, ModelInfo, mistralDefaultModelId, mistralModels } from "@shared/api"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import { fetch } from "@/shared/net"
import { ApiHandler, CommonApiHandlerOptions } from "../"
import { withRetry } from "../retry"
import { convertToMistralMessages } from "../transform/mistral-format"
import { ApiStream } from "../transform/stream"

interface MistralHandlerOptions extends CommonApiHandlerOptions {
	mistralApiKey?: string
	apiModelId?: string
}

export class MistralHandler implements ApiHandler {
	private options: MistralHandlerOptions
	private client: Mistral | undefined

	constructor(options: MistralHandlerOptions) {
		this.options = options
	}

	private ensureClient(): Mistral {
		if (!this.client) {
			if (!this.options.mistralApiKey) {
				throw new Error("Mistral API key is required")
			}
			try {
				// Create HTTP client with custom fetch for proxy support
				const httpClient = new HTTPClient({
					fetcher: (request) => {
						return fetch(request)
					},
				})

				this.client = new Mistral({
					apiKey: this.options.mistralApiKey,
					httpClient,
				})
			} catch (error) {
				throw new Error(`Error creating Mistral client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[], tools?: OpenAITool[]): ApiStream {
		const client = this.ensureClient()
		const stream = await client.chat
			.stream({
				model: this.getModel().id,
				// max_completion_tokens: this.getModel().info.maxTokens,
				temperature: 0,
				messages: [{ role: "system", content: systemPrompt }, ...convertToMistralMessages(messages)],
				stream: true,
				tools: tools?.length ? (tools as MistralTool[]) : undefined,
				toolChoice: tools?.length ? "any" : undefined,
			})
			.catch((err) => {
				// The Mistal SDK uses statusCode instead of status
				// However, if they introduce status for something, I don't want to override it
				if ("statusCode" in err && !("status" in err)) {
					err.status = err.statusCode
				}

				throw err
			})

		for await (const chunk of stream) {
			const delta = chunk.data.choices[0]?.delta
			if (delta.toolCalls) {
				for (const toolCall of delta.toolCalls) {
					yield {
						type: "tool_calls",
						tool_call: {
							function: {
								id: toolCall.id,
								name: toolCall.function.name,
								arguments: JSON.stringify(toolCall.function.arguments),
							},
						},
					}
				}
			} else if (delta?.content) {
				let content: string = ""
				if (typeof delta.content === "string") {
					content = delta.content
				} else if (Array.isArray(delta.content)) {
					content = delta.content.map((c) => (c.type === "text" ? c.text : "")).join("")
				}
				yield {
					type: "text",
					text: content,
				}
			}

			if (chunk.data.usage) {
				yield {
					type: "usage",
					inputTokens: chunk.data.usage.promptTokens || 0,
					outputTokens: chunk.data.usage.completionTokens || 0,
				}
			}
		}
	}

	getModel(): { id: MistralModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in mistralModels) {
			const id = modelId as MistralModelId
			return { id, info: mistralModels[id] }
		}
		return {
			id: mistralDefaultModelId,
			info: mistralModels[mistralDefaultModelId],
		}
	}
}
