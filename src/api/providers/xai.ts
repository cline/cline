import { Anthropic } from "@anthropic-ai/sdk"
import { ApiHandler } from "../index"
import { ApiHandlerOptions, ModelInfo, xAiModels } from "../../shared/api"
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
		const modelId = this.options.xAiModelId ?? "grok-2-1212"

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
			throw new Error(`xAI API error: ${response.status} ${response.statusText}`)
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
				}
			}
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.xAiModelId ?? "grok-2-1212"
		const info = xAiModels[modelId as keyof typeof xAiModels] || xAiModels["grok-2-1212"]
		return {
			id: modelId,
			info,
		}
	}
}
