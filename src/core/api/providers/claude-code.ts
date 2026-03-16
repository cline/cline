import { filterMessagesForClaudeCode } from "@/integrations/claude-code/message-filter"
import { runClaudeCode } from "@/integrations/claude-code/run"
import { ClaudeCodeModelId, claudeCodeDefaultModelId, claudeCodeModels } from "@/shared/api"
import { ClineStorageMessage } from "@/shared/messages/content"
import { Logger } from "@/shared/services/Logger"
import { type ApiHandler, CommonApiHandlerOptions } from ".."
import { withRetry } from "../retry"
import { type ApiStream, ApiStreamUsageChunk } from "../transform/stream"

interface ClaudeCodeHandlerOptions extends CommonApiHandlerOptions {
	claudeCodePath?: string
	apiModelId?: string
	thinkingBudgetTokens?: number
}

export class ClaudeCodeHandler implements ApiHandler {
	private options: ClaudeCodeHandlerOptions

	constructor(options: ClaudeCodeHandlerOptions) {
		this.options = options
	}

	@withRetry({
		maxRetries: 4,
		baseDelay: 2000,
		maxDelay: 15000,
	})
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[]): ApiStream {
		// Filter out image blocks since Claude Code doesn't support them
		const filteredMessages = filterMessagesForClaudeCode(messages)

		const claudeProcess = runClaudeCode({
			systemPrompt,
			messages: filteredMessages,
			path: this.options.claudeCodePath,
			modelId: this.getModel().id,
			thinkingBudgetTokens: this.options.thinkingBudgetTokens,
		})

		// Usage is included with assistant messages,
		// but cost is included in the result chunk
		const usage: ApiStreamUsageChunk = {
			type: "usage",
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		}

		let isPaidUsage = true

		for await (const chunk of claudeProcess) {
			if (typeof chunk === "string") {
				yield {
					type: "text",
					text: chunk,
				}

				continue
			}

			// Handle system init messages
			if (chunk.type === "system" && "subtype" in chunk) {
				if (chunk.subtype === "init") {
					// Based on my tests, subscription usage sets the `apiKeySource` to "none"
					isPaidUsage = (chunk as any).apiKeySource !== "none"
				}
				// Also handles legacy rate_limit_event format (type: "system", subtype: "rate_limit_event")
				// by falling through — no special handling needed.
				continue
			}

			// Handle rate_limit_event (newer CLI format: top-level type)
			if (chunk.type === "rate_limit_event") {
				// Rate limit events are informational. Log them but don't yield anything.
				// If the rate limit blocks the response, the stream will end without
				// assistant messages and the task loop will handle the empty response.
				Logger.log("Claude Code rate limit event:", JSON.stringify(chunk))
				continue
			}

			// Skip user messages (tool results from Claude Code's own tool execution)
			if (chunk.type === "user") {
				continue
			}

			if (chunk.type === "assistant" && "message" in chunk) {
				const message = chunk.message

				// Check for error field on the message (newer CLI format)
				if (message.error) {
					const firstContent = message.content?.[0]
					const errorText = firstContent && "text" in firstContent ? firstContent.text : undefined
					throw new Error(errorText ?? `Claude Code error: ${message.error}`)
				}

				if (message.stop_reason !== null) {
					const firstContent = message.content?.[0]
					const content = firstContent && "text" in firstContent ? firstContent : undefined

					// Check if content exists before accessing its properties
					if (content && content.text.startsWith(`API Error`)) {
						// Error messages are formatted as: `API Error: <<status code>> <<json>>`
						const errorMessageStart = content.text.indexOf("{")
						const errorMessage = content.text.slice(errorMessageStart)

						const error = this.attemptParse(errorMessage)
						if (!error) {
							throw new Error(content.text)
						}

						if (error.error.message.includes("Invalid model name")) {
							throw new Error(
								content.text +
									`\n\nAPI keys and subscription plans allow different models. Make sure the selected model is included in your plan.`,
							)
						}

						throw new Error(errorMessage)
					}
				}

				for (const content of message.content) {
					switch (content.type) {
						case "text":
							yield {
								type: "text",
								text: content.text,
							}
							break
						case "thinking":
							yield {
								type: "reasoning",
								reasoning: content.thinking || "",
							}
							break
						case "redacted_thinking":
							yield {
								type: "reasoning",
								reasoning: "[Redacted thinking block]",
							}
							break
						case "tool_use":
							// Yield tool_use blocks to the streaming pipeline for proper tool execution
							yield {
								type: "tool_calls",
								tool_call: {
									call_id: content.id,
									function: {
										id: content.id,
										name: content.name,
										arguments: JSON.stringify(content.input),
									},
								},
							}
							break
						default: {
							// Handle unknown content block types gracefully.
							// Newer Anthropic models or CLI versions may introduce new content types
							// (e.g., server_tool_use, mcp_tool_use). Log them instead of silently dropping.
							const unknownBlock = content as { type: string; text?: string }
							Logger.warn(`Unhandled content type in Claude Code response: ${unknownBlock.type}`)
							// If the unknown block has a text-like field, try to yield it as text
							if (typeof unknownBlock.text === "string") {
								yield {
									type: "text",
									text: unknownBlock.text,
								}
							}
							break
						}
					}
				}

				// According to Anthropic's API documentation:
				// https://docs.anthropic.com/en/api/messages#usage-object
				// The `input_tokens` field already includes both `cache_read_input_tokens` and `cache_creation_input_tokens`.
				// Therefore, we should not add cache tokens to the input_tokens count again, as this would result in double-counting.
				usage.inputTokens = message.usage?.input_tokens ?? 0
				usage.outputTokens = message.usage?.output_tokens ?? 0
				usage.cacheReadTokens = message.usage?.cache_read_input_tokens ?? 0
				usage.cacheWriteTokens = message.usage?.cache_creation_input_tokens ?? 0

				continue
			}

			if (chunk.type === "result" && "result" in chunk) {
				if (chunk.is_error) {
					throw new Error(`Claude Code returned an error: ${chunk.result}`)
				}

				usage.totalCost = isPaidUsage ? chunk.total_cost_usd : 0

				yield usage
				continue
			}

			// Any completely unrecognized chunk type — log and skip
			Logger.warn(`Unrecognized Claude Code chunk type: ${(chunk as any).type}`)
		}
	}

	private attemptParse(str: string) {
		try {
			return JSON.parse(str)
		} catch (_err) {
			return null
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
}
