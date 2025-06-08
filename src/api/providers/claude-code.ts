import type { Anthropic } from "@anthropic-ai/sdk"
import { anthropicDefaultModelId, anthropicModels, type ApiHandlerOptions } from "@/shared/api"
import { type ApiHandler } from ".."
import { ApiStreamUsageChunk, type ApiStream } from "../transform/stream"
import { withRetry } from "../retry"
import { runClaudeCode } from "@/integrations/claude-code/run"
import { ClaudeCodeMessage } from "@/integrations/claude-code/types"

export class ClaudeCodeHandler implements ApiHandler {
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
		// TODO: Extract the path from the options
		const claudeProcess = runClaudeCode({
			systemPrompt,
			messages,
		})

		const dataQueue: string[] = []
		let isProcessComplete = false
		let processError = null

		let errorOutput = ""

		claudeProcess.stdout.on("data", (data) => {
			const output = data.toString()
			const lines = output.split("\n").filter((line: string) => line.trim() !== "")

			for (const line of lines) {
				console.log("Received line:", line)
				dataQueue.push(line)
			}
		})

		claudeProcess.stderr.on("data", (data) => {
			errorOutput += data.toString()
		})

		claudeProcess.on("close", () => {
			if (errorOutput) {
				throw new Error(`ripgrep process error: ${errorOutput}`)
			}

			isProcessComplete = true
		})

		claudeProcess.on("error", (error) => {
			processError = error
		})

		// Usage is included with assistant messages,
		// but cost is included in the result chunk
		let usage: ApiStreamUsageChunk = {
			type: "usage",
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		}

		while (!isProcessComplete || dataQueue.length > 0) {
			if (dataQueue.length === 0) {
				await new Promise((resolve) => setImmediate(resolve))
			}

			const data = dataQueue.shift()
			if (!data) {
				continue
			}

			const chunk = this.attemptParseChunk(data)

			if (!chunk) {
				yield {
					type: "text",
					text: data || "",
				}

				continue
			}

			if (chunk.type === "system" && chunk.subtype === "init") {
				continue
			}

			if (chunk.type === "assistant" && "message" in chunk) {
				const message = chunk.message

				if (message.stop_reason !== null) {
					const errorMessage = message.content[0]?.text || `Claude Code stopped with reason: ${message.stop_reason}`

					throw new Error(errorMessage)
				}

				for (const content of message.content) {
					if (content.type === "text") {
						yield {
							type: "text",
							text: content.text,
						}
					} else {
						console.warn("Unsupported content type:", content.type)
					}
				}

				usage.inputTokens += message.usage.input_tokens
				usage.outputTokens += message.usage.output_tokens
				usage.cacheReadTokens = (usage.cacheReadTokens || 0) + (message.usage.cache_read_input_tokens || 0)
				usage.cacheWriteTokens = (usage.cacheWriteTokens || 0) + (message.usage.cache_creation_input_tokens || 0)

				continue
			}

			if (chunk.type === "result" && "result" in chunk) {
				usage.totalCost = chunk.cost_usd || 0

				yield usage
			}

			if (processError) {
				throw processError
			}
		}
	}

	getModel() {
		return {
			id: anthropicDefaultModelId,
			info: anthropicModels[anthropicDefaultModelId],
		}
	}

	// TOOD: Validate instead of parsing
	private attemptParseChunk(data: string): ClaudeCodeMessage | null {
		try {
			return JSON.parse(data)
		} catch (error) {
			console.error("Error parsing chunk:", error)
			return null
		}
	}
}
