import { ApiHandler } from ".."
import { ApiStream } from "../transform/stream"
import { ApiHandlerOptions, ModelInfo, premModels, premDefaultModelId, PremModelId } from "../../shared/api"
import type { Anthropic } from "@anthropic-ai/sdk"

// Update ApiHandlerOptions in shared/api.ts to include these
declare module "../../shared/api" {
	interface ApiHandlerOptions {
		premApiKey?: string
		premBaseUrl?: string
		premProjectId?: number
		premModelId?: string
	}
}

interface PremChatCompletionInput {
	project_id: number
	messages: Array<{
		role: string
		content: string
	}>
	model: string
	stream?: boolean
	temperature?: number
}

interface PremEmbeddingsInput {
	project_id: number
	model: string
	input: string | string[]
}

export class PremHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private baseUrl: string
	private projectId: number
	private modelId: PremModelId

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.baseUrl = options.premBaseUrl || "https://app.premai.io"
		this.projectId = Number(options.premProjectId) || 1
		this.modelId = (options.premModelId as PremModelId) || premDefaultModelId
	}

	private async fetchWithAuth(endpoint: string, options: RequestInit) {
		const headers = new Headers(options.headers)
		headers.set("Authorization", `Bearer ${this.options.premApiKey}`)

		const response = await fetch(`${this.baseUrl}${endpoint}`, {
			...options,
			headers,
		})

		if (!response.ok) {
			const error = await response.json()
			throw new Error(error.message || "Unknown error occurred")
		}

		return response
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const formattedMessages = messages.map((msg) => ({
			role: msg.role,
			content:
				typeof msg.content === "string"
					? msg.content
					: msg.content
							.map((block) => {
								if ("text" in block && block.text) {
									return block.text
								}
								if (
									"image_url" in block &&
									typeof block.image_url === "object" &&
									block.image_url &&
									"url" in block.image_url
								) {
									return `<image>${block.image_url.url}</image>`
								}
								return ""
							})
							.filter(Boolean)
							.join("\n"),
		}))

		const payload: PremChatCompletionInput = {
			project_id: this.projectId,
			model: this.modelId,
			messages: [{ role: "system", content: systemPrompt }, ...formattedMessages],
			stream: true,
			temperature: 0.7,
		}

		const response = await this.fetchWithAuth("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(payload),
		})

		if (response.body) {
			const reader = response.body.getReader()
			const decoder = new TextDecoder()

			while (true) {
				const { done, value } = await reader.read()
				if (done) {
					break
				}

				const chunk = decoder.decode(value)
				const lines = chunk.split("\n").filter((line) => line.trim())

				for (const line of lines) {
					if (line.startsWith("data: ")) {
						const data = JSON.parse(line.slice(5))
						if (data.choices?.[0]?.message?.content) {
							yield {
								type: "text",
								text: data.choices[0].message.content,
							}
						}
					}
				}
			}
		}
	}

	async createEmbeddings(input: string | string[]): Promise<number[][]> {
		const payload: PremEmbeddingsInput = {
			project_id: this.projectId,
			model: this.modelId,
			input: input,
		}

		const response = await this.fetchWithAuth("/v1/embeddings", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(payload),
		})

		const result = await response.json()
		return result.data.map((item: { embedding: number[] }) => item.embedding)
	}

	getModel(): { id: string; info: ModelInfo } {
		return {
			id: this.modelId,
			info: premModels[this.modelId],
		}
	}
}
