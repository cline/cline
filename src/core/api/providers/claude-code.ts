import { filterMessagesForClaudeCode } from "@/integrations/claude-code/message-filter"
import { runClaudeCode } from "@/integrations/claude-code/run"
import { ClaudeCodeModelId, claudeCodeDefaultModelId, claudeCodeModels } from "@/shared/api"
import { ClineStorageMessage } from "@/shared/messages/content"
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
			totalCost: 0, // Initialize to 0, will be updated if paid
		}

		let isPaidUsage = true
		let didReceiveStreamEvents = false

		for await (const chunk of claudeProcess) {
			if (typeof chunk === "string") {
				yield {
					type: "text",
					text: chunk,
				}

				continue
			}

			if (chunk.type === "system" && chunk.subtype === "init") {
				// Based on my tests, subscription usage sets the `apiKeySource` to "none"
				isPaidUsage = chunk.apiKeySource !== "none"
				continue
			}

			// Handle streaming events from --include-partial-messages flag
			if (chunk.type === "stream_event" && "event" in chunk) {
				didReceiveStreamEvents = true
				const event = chunk.event

				switch (event.type) {
					case "message_start":
						// Yield initial usage stats
						usage.inputTokens = event.message.usage.input_tokens || 0
						usage.cacheWriteTokens = event.message.usage.cache_creation_input_tokens || 0
						usage.cacheReadTokens = event.message.usage.cache_read_input_tokens || 0
						usage.outputTokens = event.message.usage.output_tokens || 0
						// Keep totalCost at 0 until we get the result chunk with actual cost
						usage.totalCost = 0
						yield usage
						break

					case "content_block_start":
						switch (event.content_block.type) {
							case "thinking": {
								const thinking = event.content_block.thinking
								const signature = event.content_block.signature
								if (thinking || signature) {
									yield {
										type: "reasoning",
										reasoning: thinking || "",
										signature,
									}
								}
								break
							}
							case "redacted_thinking":
								yield {
									type: "reasoning",
									reasoning: "[Redacted thinking block]",
								}
								break
							case "text":
								// Insert line break between multiple text blocks
								if (event.index > 0) {
									yield {
										type: "text",
										text: "\n",
									}
								}
								// Initial text block may have content
								if (event.content_block.text) {
									yield {
										type: "text",
										text: event.content_block.text,
									}
								}
								break
						}
						break

					case "content_block_delta":
						switch (event.delta.type) {
							case "text_delta":
								yield {
									type: "text",
									text: event.delta.text || "",
								}
								break
							case "thinking_delta": {
								const deltaStr = event.delta.thinking || ""
								if (deltaStr) {
									yield {
										type: "reasoning",
										reasoning: deltaStr,
									}
								}
								break
							}
							case "signature_delta": {
								const signature = event.delta.signature
								if (signature) {
									yield {
										type: "reasoning",
										reasoning: "",
										signature,
									}
								}
								break
							}
						}
						break

					case "message_delta":
						// Update output tokens (cumulative count, not delta)
						usage.outputTokens = event.usage.output_tokens || 0
						// Keep totalCost at 0 until we get the result chunk with actual cost
						usage.totalCost = 0
						yield usage
						break

					case "content_block_stop":
						// No-op for reasoning; nothing to flush when using pure deltas
						break

					case "message_stop":
						// No-op for reasoning; nothing to flush when using pure deltas
						break
				}

				continue
			}

			// Keep backward compatibility with older Claude CLI versions that don't support --include-partial-messages
			// Also extract tool_use blocks which are ONLY available in the assistant chunk (not in stream events)
			// NOTE: Stream events only support text, thinking, and redacted_thinking content types.
			// Tool use blocks MUST be extracted from the assistant chunk regardless of streaming mode.
			if (chunk.type === "assistant" && "message" in chunk) {
				const message = chunk.message

				if (message.stop_reason !== null) {
					const content = "text" in message.content[0] ? message.content[0] : undefined

					const isError = content && content.text.startsWith(`API Error`)
					if (isError) {
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
							// Skip text if already streamed via stream_event to avoid duplicates
							if (!didReceiveStreamEvents) {
								yield {
									type: "text",
									text: content.text,
								}
							}
							break
						case "thinking":
							// Skip thinking if already streamed via stream_event to avoid duplicates
							if (!didReceiveStreamEvents) {
								yield {
									type: "reasoning",
									reasoning: content.thinking || "",
								}
							}
							break
						case "redacted_thinking":
							// Skip redacted_thinking if already streamed via stream_event to avoid duplicates
							if (!didReceiveStreamEvents) {
								yield {
									type: "reasoning",
									reasoning: "[Redacted thinking block]",
								}
							}
							break
						case "tool_use":
							// ALWAYS yield tool_use blocks - they are NOT available in stream events!
							// Stream events only contain text, thinking, and redacted_thinking deltas.
							yield {
								type: "tool_calls",
								tool_call: {
									call_id: content.id,
									function: {
										id: content.id,
										name: content.name,
										arguments: content.input,
									},
								},
							}
							break
					}
				}

				// Only update usage from assistant chunk if we didn't get it from stream events
				// (to avoid overwriting with potentially stale data)
				if (!didReceiveStreamEvents) {
					// According to Anthropic's API documentation:
					// https://docs.anthropic.com/en/api/messages#usage-object
					// The `input_tokens` field already includes both `cache_read_input_tokens` and `cache_creation_input_tokens`.
					// Therefore, we should not add cache tokens to the input_tokens count again, as this would result in double-counting.
					usage.inputTokens = message.usage?.input_tokens ?? 0
					usage.outputTokens = message.usage?.output_tokens ?? 0
					usage.cacheReadTokens = message.usage?.cache_read_input_tokens ?? 0
					usage.cacheWriteTokens = message.usage?.cache_creation_input_tokens ?? 0
				}

				continue
			}

			if (chunk.type === "result" && "result" in chunk) {
				usage.totalCost = isPaidUsage ? chunk.total_cost_usd : 0

				yield usage
			}
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
