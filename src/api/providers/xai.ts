import { Anthropic } from "@anthropic-ai/sdk"
import { ApiHandler } from "../index"
import { ApiHandlerOptions, ModelInfo, xAiModels, XAiModelId, xAiDefaultModelId } from "../../shared/api"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import { withRetry } from "../retry"

export class XAiHandler implements ApiHandler {
	private options: ApiHandlerOptions

	constructor(options: ApiHandlerOptions) {
		this.options = options
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		if (!this.options.xAiApiKey) {
			throw new Error("X.AI API key is required")
		}

		const { id: modelId } = this.getModel()

		try {
			const response = await fetch("https://api.x.ai/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.options.xAiApiKey}`,
				},
				body: JSON.stringify({
					model: modelId,
					messages: [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
					temperature: 0,
					stream: true,
				}),
			})

			if (!response.ok) {
				let error = `X.AI API error: ${response.status} ${response.statusText}`
				try {
					const errorData = await response.json()
					if (errorData.error?.message) {
						error += ` - ${errorData.error.message}`
					}
				} catch {
					// Ignore JSON parsing errors in error response
				}
				throw new Error(error)
			}

			const reader = response.body?.getReader()
			if (!reader) {
				throw new Error("Failed to get response reader")
			}

			while (true) {
				const { done, value } = await reader.read()
				if (done) break

				const chunk = new TextDecoder().decode(value)
				const lines = chunk.split("\n").filter((line) => line.trim())

				for (const line of lines) {
					if (line.startsWith("data: ")) {
						try {
							const data = JSON.parse(line.slice(6))
							if (data.choices?.[0]?.delta?.content) {
								yield {
									type: "text",
									text: data.choices[0].delta.content,
								}
							}
							if (data.usage) {
								yield {
									type: "usage",
									inputTokens: data.usage.prompt_tokens || 0,
									outputTokens: data.usage.completion_tokens || 0,
								}
							}
						} catch (e) {
							console.error("Failed to parse SSE message:", e)
							continue
						}
					}
				}
			}
		} catch (error) {
			if (error instanceof Error) {
				throw error
			}
			throw new Error(`X.AI API error: ${error}`)
		}
	}

	getModel(): { id: XAiModelId; info: ModelInfo } {
		const modelId = this.options.xAiModelId
		if (modelId && modelId in xAiModels) {
			const id = modelId as XAiModelId
			return { id, info: xAiModels[id] }
		}
		return {
			id: xAiDefaultModelId,
			info: xAiModels[xAiDefaultModelId],
		}
	}
}
