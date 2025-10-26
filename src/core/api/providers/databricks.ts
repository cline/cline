import { Anthropic } from "@anthropic-ai/sdk"
import { DatabricksModelId, databricksDefaultModelId, databricksModels, ModelInfo } from "@shared/api"
import { ApiHandler, CommonApiHandlerOptions } from "../index"
import { withRetry } from "../retry"
import { ApiStream } from "../transform/stream"

interface DatabricksHandlerOptions extends CommonApiHandlerOptions {
	databricksApiKey?: string
	databricksBaseUrl?: string
	apiModelId?: string
	thinkingBudgetTokens?: number
}

export class DatabricksHandler implements ApiHandler {
	private options: DatabricksHandlerOptions
	private client: Anthropic | undefined

	constructor(options: DatabricksHandlerOptions) {
		this.options = options
	}

	private ensureClient(): Anthropic {
		if (!this.client) {
			if (!this.options.databricksApiKey) {
				throw new Error("Databricks API key is required")
			}
			if (!this.options.databricksBaseUrl) {
				throw new Error("Databricks Base URL is required")
			}
			try {
				// Ensure base URL ends with /serving-endpoints
				let baseUrl = this.options.databricksBaseUrl.trim()

				// Remove trailing slash if present
				if (baseUrl.endsWith("/")) {
					baseUrl = baseUrl.slice(0, -1)
				}

				// Remove /anthropic suffix if already present
				if (baseUrl.endsWith("/anthropic")) {
					baseUrl = baseUrl.replace(/\/anthropic$/, "")
				}

				// Ensure it ends with /serving-endpoints
				if (!baseUrl.endsWith("/serving-endpoints")) {
					if (baseUrl.includes("/serving-endpoints/")) {
						baseUrl = baseUrl.split("/serving-endpoints")[0] + "/serving-endpoints"
					}
				}

				// Add /anthropic for Claude models
				baseUrl = `${baseUrl}/anthropic`

				// Databricks requires Authorization: Bearer header instead of x-api-key
				this.client = new Anthropic({
					apiKey: this.options.databricksApiKey,
					baseURL: baseUrl,
					defaultHeaders: {
						Authorization: `Bearer ${this.options.databricksApiKey}`,
					},
				})
			} catch (error) {
				throw new Error(`Error creating Databricks client: ${(error as Error).message}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const client = this.ensureClient()
		const model = this.getModel()

		const budget_tokens = this.options.thinkingBudgetTokens || 0
		const reasoningOn = !!(
			(model.id.includes("3-7") || model.id.includes("4-") || model.id.includes("4-5")) &&
			budget_tokens !== 0
		)

		// Databricks streaming doesn't work properly, so we use non-streaming and simulate a stream
		const response = await client.messages.create({
			model: model.id,
			thinking: reasoningOn ? { type: "enabled", budget_tokens: budget_tokens } : undefined,
			max_tokens: model.info.maxTokens || 8192,
			temperature: reasoningOn ? undefined : 0,
			system: systemPrompt,
			messages: messages,
			stream: false,
		})

		// Simulate streaming by yielding the response as chunks
		// Yield usage information
		yield {
			type: "usage",
			inputTokens: response.usage.input_tokens || 0,
			outputTokens: response.usage.output_tokens || 0,
			cacheWriteTokens: response.usage.cache_creation_input_tokens || undefined,
			cacheReadTokens: response.usage.cache_read_input_tokens || undefined,
		}

		// Yield content blocks
		for (let i = 0; i < response.content.length; i++) {
			const block = response.content[i]

			if (block.type === "text") {
				// Add newline between multiple text blocks
				if (i > 0) {
					yield {
						type: "text",
						text: "\n",
					}
				}

				// Yield the text content
				yield {
					type: "text",
					text: block.text,
				}
			}
		}
	}

	getModel(): { id: DatabricksModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in databricksModels) {
			const id = modelId as DatabricksModelId
			return { id, info: databricksModels[id] }
		}
		return {
			id: databricksDefaultModelId,
			info: databricksModels[databricksDefaultModelId],
		}
	}
}
