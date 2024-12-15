import { Anthropic } from "@anthropic-ai/sdk"
import { ApiHandlerOptions, ModelInfo, cerebrasModels } from "../../shared/api"
import { ApiHandler } from "../index"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

export class CerebrasHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private baseUrl: string
	private modelId: string

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.baseUrl = options.cerebrasBaseUrl ?? "https://inference.cerebras.ai/v1"
		this.modelId = options.apiModelId ?? "llama3.1-8b"
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const openAiMessages = [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)]

		const requestBody = {
			model: this.modelId,
			messages: openAiMessages,
			temperature: 0.7,
			top_p: 0.95,
			max_tokens: cerebrasModels[this.modelId as keyof typeof cerebrasModels]?.maxTokens ?? 4096,
			stream: true,
		}

		const response = await fetch(`${this.baseUrl}/chat/completions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.options.cerebrasApiKey}`,
			},
			body: JSON.stringify(requestBody),
		})

		if (!response.ok) {
			let errorMessage = `Cerebras API error: ${response.statusText}`
			try {
				const errorData = await response.json()
				errorMessage = `Cerebras API error: ${errorData.error?.message || response.statusText}`
			} catch {
				// Use default error message if JSON parsing fails
			}
			throw new Error(errorMessage)
		}

		const reader = response.body?.getReader()
		if (!reader) {
			throw new Error("No response body")
		}

		while (true) {
			const { done, value } = await reader.read()
			if (done) {
				break
			}

			const chunk = new TextDecoder().decode(value)
			const lines = chunk.split("\n").filter((line) => line.trim() !== "")

			for (const line of lines) {
				if (line.startsWith("data: ")) {
					const data = JSON.parse(line.slice(6))
					if (data.choices?.[0]?.delta?.content) {
						yield {
							type: "text",
							text: data.choices[0].delta.content,
						}
					}
				}
			}
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		if (!(this.modelId in cerebrasModels)) {
			throw new Error(`Invalid Cerebras model ID: ${this.modelId}`)
		}
		return {
			id: this.modelId,
			info: cerebrasModels[this.modelId as keyof typeof cerebrasModels],
		}
	}
}
