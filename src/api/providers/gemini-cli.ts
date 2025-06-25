import type { Anthropic } from "@anthropic-ai/sdk"
import { geminiDefaultModelId, GeminiModelId, geminiModels, type ApiHandlerOptions } from "@/shared/api"
import { type ApiHandler } from ".."
import { type ApiStream } from "../transform/stream"
import { withRetry } from "../retry"
import { runGeminiCli } from "@/integrations/gemini-cli/run"
import { convertAnthropicToGeminiCliFormat } from "@/integrations/gemini-cli/message-converter"

export class GeminiCliHandler implements ApiHandler {
	private options: ApiHandlerOptions

	constructor(options: ApiHandlerOptions) {
		this.options = options
	}

	@withRetry({
		maxRetries: 4,
		baseDelay: 2000,
		maxDelay: 15000,
	})
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		// Convert messages to Gemini CLI format
		const prompt = convertAnthropicToGeminiCliFormat(systemPrompt, messages)

		console.log("[GeminiCliHandler] Starting Gemini CLI with prompt length:", prompt.length)
		console.log("[GeminiCliHandler] Model:", this.getModel().id)
		console.log("[GeminiCliHandler] Path:", this.options.geminiCliPath || "gemini")

		const geminiProcess = runGeminiCli({
			prompt,
			path: this.options.geminiCliPath,
			modelId: this.getModel().id,
		})

		let totalText = ""
		let hasYieldedContent = false

		for await (const chunk of geminiProcess) {
			if (typeof chunk === "string") {
				totalText += chunk
				hasYieldedContent = true
				console.log("[GeminiCliHandler] Received chunk:", chunk.substring(0, 100) + "...")
				yield {
					type: "text",
					text: chunk,
				}
			} else if (chunk.type === "error") {
				console.error("[GeminiCliHandler] Error from Gemini CLI:", chunk.message)
				throw new Error(chunk.message)
			}
		}

		// If no content was yielded, something went wrong
		if (!hasYieldedContent) {
			throw new Error("Gemini CLI did not return any content")
		}

		// Since Gemini CLI doesn't provide token usage in non-interactive mode,
		// we'll estimate based on the text length
		const estimatedTokens = Math.ceil(totalText.length / 4)
		yield {
			type: "usage",
			inputTokens: Math.ceil(prompt.length / 4),
			outputTokens: estimatedTokens,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: undefined, // Cost calculation would require actual token counts
		}
	}

	getModel() {
		const modelId = this.options.apiModelId
		if (modelId && modelId in geminiModels) {
			const id = modelId as GeminiModelId
			return { id, info: geminiModels[id] }
		}

		return {
			id: geminiDefaultModelId,
			info: geminiModels[geminiDefaultModelId],
		}
	}
}
