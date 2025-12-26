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

		// Usage is included with assistant messages/events,
		// but cost is included in the result chunk.
		//
		// IMPORTANT: Task-level metrics currently accumulate (`+=`) usage chunks.
		// Claude Code emits cumulative usage totals, so we must convert them to deltas here.
		const lastUsageTotals = {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		}

		const makeUsageDelta = (current: {
			id?: string
			inputTokens: number
			outputTokens: number
			cacheReadTokens: number
			cacheWriteTokens: number
			totalCost?: number
		}): ApiStreamUsageChunk => {
			const delta = (currentValue: number, lastValue: number) => Math.max(0, currentValue - lastValue)

			const chunk: ApiStreamUsageChunk = {
				type: "usage",
				id: current.id,
				inputTokens: delta(current.inputTokens, lastUsageTotals.inputTokens),
				outputTokens: delta(current.outputTokens, lastUsageTotals.outputTokens),
				cacheReadTokens: delta(current.cacheReadTokens, lastUsageTotals.cacheReadTokens),
				cacheWriteTokens: delta(current.cacheWriteTokens, lastUsageTotals.cacheWriteTokens),
				// totalCost is not a delta; Task overwrites it, so emit the latest value when we have it.
				totalCost: current.totalCost ?? 0,
			}

			lastUsageTotals.inputTokens = current.inputTokens
			lastUsageTotals.outputTokens = current.outputTokens
			lastUsageTotals.cacheReadTokens = current.cacheReadTokens
			lastUsageTotals.cacheWriteTokens = current.cacheWriteTokens

			return chunk
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
					case "message_start": {
						// Claude Code usage values are cumulative totals -> convert to deltas for Task.
						// Reset last totals for a new message stream.
						lastUsageTotals.inputTokens = 0
						lastUsageTotals.outputTokens = 0
						lastUsageTotals.cacheReadTokens = 0
						lastUsageTotals.cacheWriteTokens = 0

						const inputTokens = event.message.usage.input_tokens || 0
						const cacheWriteTokens = event.message.usage.cache_creation_input_tokens || 0
						const cacheReadTokens = event.message.usage.cache_read_input_tokens || 0
						const outputTokens = event.message.usage.output_tokens || 0

						yield makeUsageDelta({
							id: event.message.id,
							inputTokens,
							outputTokens,
							cacheReadTokens,
							cacheWriteTokens,
							totalCost: 0,
						})
						break
					}

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

					case "message_delta": {
						// output_tokens is cumulative -> convert to delta.
						// MessageDeltaEvent does not include a message id; keep it undefined here.
						yield makeUsageDelta({
							inputTokens: lastUsageTotals.inputTokens,
							outputTokens: event.usage.output_tokens || 0,
							cacheReadTokens: lastUsageTotals.cacheReadTokens,
							cacheWriteTokens: lastUsageTotals.cacheWriteTokens,
							totalCost: 0,
						})
						break
					}

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
						case "tool_use": {
							// ALWAYS yield tool_use blocks - they are NOT available in stream events!
							// Stream events only contain text, thinking, and redacted_thinking deltas.
							//
							// Important: the native-tool-call streaming pipeline expects `function.arguments` as JSON text.
							// Claude Code returns `tool_use.input` as an object, so stringify it here.
							const argumentsJson =
								typeof content.input === "string" ? content.input : JSON.stringify(content.input ?? {})

							yield {
								type: "tool_calls",
								tool_call: {
									call_id: content.id,
									function: {
										id: content.id,
										name: content.name,
										arguments: argumentsJson,
									},
								},
							}
							break
						}
					}
				}

				// Only update usage from assistant chunk if we didn't get it from stream events.
				// (Older Claude Code CLIs won't emit stream_event usage.)
				if (!didReceiveStreamEvents) {
					// According to Anthropic's API documentation:
					// https://docs.anthropic.com/en/api/messages#usage-object
					// The `input_tokens` field already includes both `cache_read_input_tokens` and `cache_creation_input_tokens`.
					const inputTokens = message.usage?.input_tokens ?? 0
					const outputTokens = message.usage?.output_tokens ?? 0
					const cacheReadTokens = message.usage?.cache_read_input_tokens ?? 0
					const cacheWriteTokens = message.usage?.cache_creation_input_tokens ?? 0

					yield makeUsageDelta({
						id: message.id,
						inputTokens,
						outputTokens,
						cacheReadTokens,
						cacheWriteTokens,
						totalCost: 0,
					})
				}

				continue
			}

			if (chunk.type === "result" && "result" in chunk) {
				// Only the cost changes here; emit it as the latest (non-delta) cost value.
				yield makeUsageDelta({
					inputTokens: lastUsageTotals.inputTokens,
					outputTokens: lastUsageTotals.outputTokens,
					cacheReadTokens: lastUsageTotals.cacheReadTokens,
					cacheWriteTokens: lastUsageTotals.cacheWriteTokens,
					totalCost: isPaidUsage ? chunk.total_cost_usd : 0,
				})
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
