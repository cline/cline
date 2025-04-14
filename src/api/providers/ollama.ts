import { Anthropic } from "@anthropic-ai/sdk"
import { Message, Ollama } from "ollama"
import { ApiHandler } from "../"
import { ApiHandlerOptions, ModelInfo, openAiModelInfoSaneDefaults } from "../../shared/api"
import { convertToOllamaMessages } from "../transform/ollama-format"
import { ApiStream } from "../transform/stream"
import { withRetry } from "../retry"

export class OllamaHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: Ollama

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new Ollama({ host: this.options.ollamaBaseUrl || "http://localhost:11434" })
	}

	@withRetry({ retryAllErrors: true })
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const ollamaMessages: Message[] = [{ role: "system", content: systemPrompt }, ...convertToOllamaMessages(messages)]

		try {
			// Create a promise that rejects after timeout
			const timeoutPromise = new Promise<never>((_, reject) => {
				setTimeout(() => reject(new Error("Ollama request timed out after 30 seconds")), 30000)
			})

			// Create the actual API request promise
			const apiPromise = this.client.chat({
				model: this.getModel().id,
				messages: ollamaMessages,
				stream: true,
				options: {
					num_ctx: Number(this.options.ollamaApiOptionsCtxNum) || 32768,
				},
			})

			// Race the API request against the timeout
			const stream = (await Promise.race([apiPromise, timeoutPromise])) as Awaited<typeof apiPromise>

			try {
				for await (const chunk of stream) {
					if (typeof chunk.message.content === "string") {
						yield {
							type: "text",
							text: chunk.message.content,
						}
					}

					// Handle token usage if available
					if (chunk.eval_count !== undefined || chunk.prompt_eval_count !== undefined) {
						yield {
							type: "usage",
							inputTokens: chunk.prompt_eval_count || 0,
							outputTokens: chunk.eval_count || 0,
						}
					}
				}
			} catch (streamError: any) {
				console.error("Error processing Ollama stream:", streamError)
				throw new Error(`Ollama stream processing error: ${streamError.message || "Unknown error"}`)
			}
		} catch (error: any) {
			// Check if it's a timeout error
			if (error.message && error.message.includes("timed out")) {
				throw new Error("Ollama request timed out after 30 seconds")
			}

			// Enhance error reporting
			const statusCode = error.status || error.statusCode
			const errorMessage = error.message || "Unknown error"

			console.error(`Ollama API error (${statusCode || "unknown"}): ${errorMessage}`)
			throw error
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		return {
			id: this.options.ollamaModelId || "",
			info: openAiModelInfoSaneDefaults,
		}
	}
}
