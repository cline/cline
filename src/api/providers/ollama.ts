import { Anthropic } from "@anthropic-ai/sdk"
import { Message, Ollama } from "ollama"
import { Agent } from "undici"
import { ApiHandler } from "../"
import { ApiHandlerOptions, ModelInfo, openAiModelInfoSaneDefaults } from "../../shared/api"
import { convertToOllamaMessages } from "../transform/ollama-format"
import { ApiStream, ApiStreamChunk } from "../transform/stream"

/**
 * OllamaHandler – communicates with an Ollama server while disabling
 * undici’s header/body time‑outs. A manual per‑request timer still enforces
 * an upper bound on total execution time so callers stay in control.
 *
 * Retry logic is intentionally *not* automatic for streaming requests; callers
 * can decide when to retry based on their UX requirements.
 */

// Disable undici time‑outs for *this* dispatcher and hand it to the SDK.
const dispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0 })
const customFetch: typeof fetch = (url: RequestInfo, init?: RequestInit) => fetch(url, { ...init, dispatcher } as any)

export class OllamaHandler implements ApiHandler {
	/** Public so unit tests can stub `.chat()` (e.g. with sinon). */
	public readonly client: Ollama

	constructor(private readonly options: ApiHandlerOptions) {
		this.client = new Ollama({
			host: options.ollamaBaseUrl ?? "http://localhost:11434",
			fetch: customFetch,
		})
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const modelId = this.options.ollamaModelId
		if (!modelId) throw new Error("Ollama model id is required")

		const ollamaMessages: Message[] = [{ role: "system", content: systemPrompt }, ...convertToOllamaMessages(messages)]

		// Caller‑configurable request timeout (default: 5 minutes)
		const timeoutMs = this.options.requestTimeoutMs ?? 300_000
		const timeoutPromise = new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error(`Ollama request timed out after ${timeoutMs / 1000} seconds`)), timeoutMs),
		)

		const apiPromise = this.client.chat({
			model: modelId,
			messages: ollamaMessages,
			stream: true,
		})

		let stream: AsyncIterable<any>
		try {
			stream = await Promise.race([apiPromise, timeoutPromise])
		} catch (err: any) {
			const cause: any = err?.cause ?? err
			if (cause?.code) {
				// e.g. ECONNREFUSED, ENOTFOUND, UND_ERR_HEADERS_TIMEOUT, …
				throw new Error(
					`Could not reach Ollama at ${
						this.options.ollamaBaseUrl ?? "http://localhost:11434"
					} — ${cause.code}: ${cause.message ?? cause}`,
				)
			}
			const statusCode = err?.status ?? err?.statusCode ?? "unknown"
			throw new Error(`Ollama API error (${statusCode}): ${err?.message ?? err}`)
		}

		// Relay streaming chunks to the caller
		for await (const chunk of stream) {
			if (typeof chunk.message.content === "string") {
				yield { type: "text", text: chunk.message.content }
			}
			if (chunk.eval_count !== undefined || chunk.prompt_eval_count !== undefined) {
				const usageData: ApiStreamChunk = {
					type: "usage",
					inputTokens: chunk.prompt_eval_count ?? 0,
					outputTokens: chunk.eval_count ?? 0,
				}
				yield usageData
			}
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		const id = this.options.ollamaModelId! // validated above
		return {
			id,
			info: this.options.ollamaApiOptionsCtxNum
				? {
						...openAiModelInfoSaneDefaults,
						contextWindow: Number(this.options.ollamaApiOptionsCtxNum) || 32_768,
					}
				: openAiModelInfoSaneDefaults,
		}
	}
}
