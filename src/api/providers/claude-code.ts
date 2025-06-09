import type { Anthropic } from "@anthropic-ai/sdk"
import { claudeCodeDefaultModelId, ClaudeCodeModelId, claudeCodeModels, type ApiHandlerOptions } from "@/shared/api"
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
		const claudeProcess = runClaudeCode({
			systemPrompt,
			messages,
			path: this.options.claudeCodePath,
			modelId: this.getModel().id,
		})

		const dataQueue: string[] = []
		let processError = null
		let errorOutput = ""
		let exitCode: number | null = null

		claudeProcess.stdout.on("data", (data) => {
			const output = data.toString()
			const lines = output.split("\n").filter((line: string) => line.trim() !== "")

			for (const line of lines) {
				dataQueue.push(line)
			}
		})

		claudeProcess.stderr.on("data", (data) => {
			errorOutput += data.toString()
		})

		claudeProcess.on("close", (code) => {
			exitCode = code
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

		while (exitCode !== 0 || dataQueue.length > 0) {
			if (dataQueue.length === 0) {
				await new Promise((resolve) => setImmediate(resolve))
			}

			if (exitCode !== null && exitCode !== 0) {
				throw new Error(
					`Claude Code process exited with code ${exitCode}.${errorOutput ? ` Error output: ${errorOutput.trim()}` : ""}`,
				)
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

				if (message.stop_reason !== null && message.stop_reason !== "tool_use") {
					const errorMessage = message.content[0]?.text || `Claude Code stopped with reason: ${message.stop_reason}`

					if (errorMessage.includes("Invalid model name")) {
						throw new Error(
							errorMessage +
								`\n\nAPI keys and subscription plans allow different models. Make sure the selected model is included in your plan.`,
						)
					}

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
		const modelId = this.options.apiModelId
		if (modelId && modelId in claudeCodeModels) {
			const id = modelId as ClaudeCodeModelId
			return { id, info: claudeCodeModels[id] }
		}

		return {
			id: claudeCodeDefaultModelId,
			info: claudeCodeModels[claudeCodeDefaultModelId],
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
