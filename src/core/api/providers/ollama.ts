import { type ModelInfo, openAiModelInfoSaneDefaults } from "@shared/api"
import { type Config, type Message, Ollama } from "ollama"
import type { ChatCompletionTool } from "openai/resources/chat/completions"
import { ClineStorageMessage } from "@/shared/messages/content"
import { fetch } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import type { ApiHandler, CommonApiHandlerOptions } from "../"
import { withRetry } from "../retry"
import { convertToOllamaMessages } from "../transform/ollama-format"
import type { ApiStream } from "../transform/stream"
import { ToolCallProcessor } from "../transform/tool-call-processor"

interface OllamaHandlerOptions extends CommonApiHandlerOptions {
	ollamaBaseUrl?: string
	ollamaApiKey?: string
	ollamaModelId?: string
	ollamaApiOptionsCtxNum?: string
	requestTimeoutMs?: number
}

const DEFAULT_CONTEXT_WINDOW = 32768

export class OllamaHandler implements ApiHandler {
	private options: OllamaHandlerOptions
	private client: Ollama | undefined

	constructor(options: OllamaHandlerOptions) {
		const ollamaApiOptionsCtxNum = (options.ollamaApiOptionsCtxNum ?? DEFAULT_CONTEXT_WINDOW).toString()
		this.options = { ...options, ollamaApiOptionsCtxNum }
	}

	private ensureClient(): Ollama {
		if (!this.client) {
			try {
				const clientOptions: Partial<Config> = {
					host: this.options.ollamaBaseUrl,
					fetch,
				}

				// Add API key if provided (for Ollama cloud or authenticated instances)
				if (this.options.ollamaApiKey) {
					clientOptions.headers = {
						Authorization: `Bearer ${this.options.ollamaApiKey}`,
					}
				}

				this.client = new Ollama(clientOptions)
			} catch (error) {
				throw new Error(`Error creating Ollama client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry({ retryAllErrors: true })
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: ChatCompletionTool[]): ApiStream {
		const client = this.ensureClient()
		const ollamaMessages: Message[] = [{ role: "system", content: systemPrompt }, ...convertToOllamaMessages(messages)]

		try {
			// Create a promise that rejects after timeout
			const timeoutMs = this.options.requestTimeoutMs || 30000
			const timeoutPromise = new Promise<never>((_, reject) => {
				setTimeout(() => reject(new Error(`Ollama request timed out after ${timeoutMs / 1000} seconds`)), timeoutMs)
			})

			// Create the actual API request promise
			const apiPromise = client.chat({
				model: this.getModel().id,
				messages: ollamaMessages,
				stream: true,
				options: {
					num_ctx: Number(this.options.ollamaApiOptionsCtxNum),
				},
				tools: tools as any,
			})

			const toolCallProcessor = new ToolCallProcessor()

			// Race the API request against the timeout
			const stream = (await Promise.race([apiPromise, timeoutPromise])) as Awaited<typeof apiPromise>

			try {
				for await (const chunk of stream) {
					Logger.debug("[OllamaHandler] Message Chunk" + JSON.stringify(chunk))

					const delta = chunk.message

					if (delta?.tool_calls) {
						Logger.debug(`[OllamaHandler] Tool Calls Detected: ${JSON.stringify(delta.tool_calls)}`)
						yield* toolCallProcessor.processToolCallDeltas(
							delta.tool_calls?.map((tc, inx) => ({
								index: inx,
								id: `ollama-tool-${inx}`,
								function: {
									name: tc.function.name,
									arguments:
										typeof tc.function.arguments === "string"
											? tc.function.arguments
											: JSON.stringify(tc.function.arguments),
								},
								type: "function",
							})),
						)
					}

					if (typeof delta.content === "string") {
						yield {
							type: "text",
							text: delta.content,
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
				Logger.error("Error processing Ollama stream:", streamError)
				throw new Error(`Ollama stream processing error: ${streamError.message || "Unknown error"}`)
			}
		} catch (error) {
			// Check if it's a timeout error
			if (error?.message?.includes("timed out")) {
				const timeoutMs = this.options.requestTimeoutMs || 30000
				throw new Error(`Ollama request timed out after ${timeoutMs / 1000} seconds`)
			}

			// Enhance error reporting
			const statusCode = error.status || error.statusCode
			const errorMessage = error.message || "Unknown error"

			Logger.error(`Ollama API error (${statusCode || "unknown"}): ${errorMessage}`)
			throw error
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		return {
			id: this.options.ollamaModelId || "",
			info: {
				...openAiModelInfoSaneDefaults,
				contextWindow: Number(this.options.ollamaApiOptionsCtxNum),
			},
		}
	}

	abort(): void {
		this.client?.abort()
	}
}
