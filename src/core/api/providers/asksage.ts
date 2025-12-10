import { AskSageModelId, askSageDefaultModelId, askSageDefaultURL, askSageModels, ModelInfo } from "@shared/api"
import { ClineStorageMessage } from "@/shared/messages/content"
import { fetch } from "@/shared/net"
import { ApiHandler, CommonApiHandlerOptions } from ".."
import { withRetry } from "../retry"
import { ApiStream } from "../transform/stream"

interface AskSageHandlerOptions extends CommonApiHandlerOptions {
	asksageApiKey?: string
	asksageApiUrl?: string
	apiModelId?: string
}

type AskSageRequest = {
	system_prompt: string
	message: {
		user: "gpt" | "me"
		message: string
	}[]
	model: string
	dataset: "none"
	usage: boolean
}

type AskSageUsage = {
	model_tokens: {
		completion_tokens: number
		prompt_tokens: number
		total_tokens: number
	}
	asksage_tokens: number
}

type AskSageResponse = {
	uuid: string
	status: number
	// Response status
	response: string
	// Generated response message
	message: string
	// whether embedding & vector systems are down
	embedding_down: boolean
	vectors_down: boolean
	// references if dataset is not none
	references: string
	type: string
	added_obj: any
	tool_calls: any
	// usage metrics
	usage: AskSageUsage | null
	tool_responses: any[]
	tool_calls_unified: any[]
}

export class AskSageHandler implements ApiHandler {
	private options: AskSageHandlerOptions
	private apiUrl: string
	private apiKey: string

	constructor(options: AskSageHandlerOptions) {
		console.log("init api url", options.asksageApiUrl, askSageDefaultURL)
		this.options = options
		this.apiKey = options.asksageApiKey || ""
		this.apiUrl = options.asksageApiUrl || askSageDefaultURL

		if (!this.apiKey) {
			throw new Error("AskSage API key is required")
		}
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[]): ApiStream {
		try {
			const model = this.getModel()
			// Transform messages into AskSageRequest format
			const formattedMessages = messages.map((msg) => {
				const content = Array.isArray(msg.content)
					? msg.content.map((block) => ("text" in block ? block.text : "")).join("")
					: msg.content

				return {
					user: msg.role === "assistant" ? ("gpt" as const) : ("me" as const),
					message: content,
				}
			})

			const request: AskSageRequest = {
				system_prompt: systemPrompt,
				message: formattedMessages,
				model: model.id,
				dataset: "none",
				usage: true,
			}

			// Make request to AskSage API
			const response = await fetch(`${this.apiUrl}/query`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-access-tokens": this.apiKey,
				},
				body: JSON.stringify(request),
			})

			if (!response.ok) {
				const error = await response.text()
				throw new Error(`AskSage API error: ${error}`)
			}

			const result = (await response.json()) as AskSageResponse

			if (!result.message) {
				throw new Error("No content in AskSage response")
			}

			// Yield tool responses if they exist
			if (result.tool_responses && result.tool_responses.length > 0) {
				for (const toolResponse of result.tool_responses) {
					yield {
						type: "text",
						text: `[Tool Response: ${JSON.stringify(toolResponse)}]\n`,
					}
				}
			}

			// Yield the main response text
			yield {
				type: "text",
				text: result.message,
			}

			// Yield usage information if available
			if (result.usage) {
				yield {
					type: "usage",
					inputTokens: result.usage.model_tokens.prompt_tokens,
					outputTokens: result.usage.model_tokens.completion_tokens,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					totalCost: result.usage.asksage_tokens, // Cost = Consumed AskSage tokens
				}
			}
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`AskSage request failed: ${error.message}`)
			}
			throw error
		}
	}

	async getApiStreamUsage() {
		if (!this.apiKey) {
			return undefined
		}

		try {
			const response = await fetch(`${this.apiUrl}/count-monthly-tokens`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-access-tokens": this.apiKey,
				},
				body: JSON.stringify({ app_name: "asksage" }),
			})

			if (!response.ok) {
				console.error("Failed to fetch AskSage usage", await response.text())
				return undefined
			}

			const data = await response.json()
			const usedTokens = data.response as number

			return {
				type: "usage" as const,
				inputTokens: usedTokens,
				outputTokens: 0,
			}
		} catch (error) {
			console.error("Error fetching AskSage usage:", error)
			return undefined
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in askSageModels) {
			const id = modelId as AskSageModelId
			return { id, info: askSageModels[id] }
		}
		return {
			id: askSageDefaultModelId,
			info: askSageModels[askSageDefaultModelId],
		}
	}
}
