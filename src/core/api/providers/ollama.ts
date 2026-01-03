import { type ModelInfo, openAiModelInfoSaneDefaults } from "@shared/api"
import { type Config, type Message, Ollama } from "ollama"
import { EnvHttpProxyAgent, fetch as undiciFetch } from "undici"
import { ClineStorageMessage } from "@/shared/messages/content"
import type { ApiHandler, CommonApiHandlerOptions } from "../"
import { withRetry } from "../retry"
import { convertToOllamaMessages } from "../transform/ollama-format"
import type { ApiStream } from "../transform/stream"

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

	/**
	 * Returns a cached client (no signal) or builds a one-off client with a per-request AbortSignal.
	 * The client always uses an Undici agent with disabled headers/body timeouts to avoid premature first-byte aborts.
	 */
	private ensureClient(signal?: AbortSignal): Ollama {
		// Reuse cached client when no per-request signal is needed
		if (!signal && this.client) {
			return this.client
		}

		const dispatcher = new EnvHttpProxyAgent({
			headersTimeout: 0,
			bodyTimeout: 0,
		})

		const longFetch: typeof globalThis.fetch = ((input: any, init?: any) => {
			const mergedInit = { ...(init || {}), dispatcher, signal } as any
			return (undiciFetch as any)(input, mergedInit)
		}) as any

		const clientOptions: Partial<Config> = {
			host: this.options.ollamaBaseUrl,
			fetch: longFetch as unknown as typeof globalThis.fetch,
		}

		// Add API key if provided (for Ollama cloud or authenticated instances)
		if (this.options.ollamaApiKey) {
			clientOptions.headers = {
				Authorization: `Bearer ${this.options.ollamaApiKey}`,
			}
		}

		const newClient = new Ollama(clientOptions)
		if (!signal) {
			// only cache signal-less client
			this.client = newClient
		}
		return newClient
	}

	@withRetry({ retryAllErrors: true })
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[]): ApiStream {
		const timeoutMs = this.options.requestTimeoutMs || 30000
		const hasTimeout = typeof timeoutMs === "number" && timeoutMs > 0
		const controller = hasTimeout ? new AbortController() : undefined
		let timeoutId: ReturnType<typeof setTimeout> | undefined
		if (hasTimeout) {
			timeoutId = setTimeout(() => {
				controller!.abort(new Error("Ollama request timed out"))
			}, timeoutMs)
		}

		// Use a one-off client when we have a signal, reuse the cached client when we don't.
		const client = this.ensureClient(controller?.signal)
		const ollamaMessages: Message[] = [{ role: "system", content: systemPrompt }, ...convertToOllamaMessages(messages)]

		try {
			const stream = await client.chat({
				model: this.getModel().id,
				messages: ollamaMessages,
				stream: true,
				options: {
					num_ctx: Number(this.options.ollamaApiOptionsCtxNum),
				},
			})

			for await (const chunk of stream) {
				if (typeof chunk.message?.content === "string") {
					yield {
						type: "text",
						text: chunk.message.content,
					}
				}
				if (chunk.eval_count !== undefined || chunk.prompt_eval_count !== undefined) {
					yield {
						type: "usage",
						inputTokens: chunk.prompt_eval_count || 0,
						outputTokens: chunk.eval_count || 0,
					}
				}
			}
		} catch (error: any) {
			if (controller?.signal.aborted) {
				const timeoutSecs = Math.floor(timeoutMs / 1000)
				throw new Error(`Ollama request timed out after ${timeoutSecs} seconds`, { cause: error })
			}
			// Enhance error reporting
			const statusCode = error.status || error.statusCode
			const errorMessage = error.message || "Unknown error"

			console.error(`Ollama API error (${statusCode || "unknown"}): ${errorMessage}`)
			throw error
		} finally {
			if (timeoutId) {
				clearTimeout(timeoutId)
			}
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
