import { Anthropic } from "@anthropic-ai/sdk"
import { Tool as AnthropicTool } from "@anthropic-ai/sdk/resources/index"
import { Stream as AnthropicStream } from "@anthropic-ai/sdk/streaming"
import { AnthropicModelId, anthropicDefaultModelId, anthropicModels, CLAUDE_SONNET_1M_SUFFIX, ModelInfo } from "@shared/api"
import { fetch } from "@/shared/net"
import { ClineTool } from "@/shared/tools"
import { ApiHandler, CommonApiHandlerOptions } from "../index"
import { withRetry } from "../retry"
import { sanitizeAnthropicMessages } from "../transform/anthropic-format"
import { ApiStream } from "../transform/stream"

interface AnthropicHandlerOptions extends CommonApiHandlerOptions {
	apiKey?: string
	anthropicBaseUrl?: string
	apiModelId?: string
	thinkingBudgetTokens?: number
}

export class AnthropicHandler implements ApiHandler {
	private options: AnthropicHandlerOptions
	private client: Anthropic | undefined

	constructor(options: AnthropicHandlerOptions) {
		this.options = options
	}

	private ensureClient(): Anthropic {
		if (!this.client) {
			if (!this.options.apiKey) {
				throw new Error("Anthropic API key is required")
			}
			try {
				this.client = new Anthropic({
					apiKey: this.options.apiKey,
					baseURL: this.options.anthropicBaseUrl || undefined,
					fetch, // Use configured fetch with proxy support
				})
			} catch (error) {
				throw new Error(`Error creating Anthropic client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[], tools?: ClineTool[]): ApiStream {
		const client = this.ensureClient()

		const model = this.getModel()
		let stream: AnthropicStream<Anthropic.RawMessageStreamEvent>

		const modelId = model.id.endsWith(CLAUDE_SONNET_1M_SUFFIX) ? model.id.slice(0, -CLAUDE_SONNET_1M_SUFFIX.length) : model.id
		const enable1mContextWindow = model.id.endsWith(CLAUDE_SONNET_1M_SUFFIX)

		const budget_tokens = this.options.thinkingBudgetTokens || 0

		// Tools are available only when native tools are enabled.
		const nativeToolsOn = tools?.length && tools?.length > 0
		const reasoningOn = !!(
			(modelId.includes("3-7") || modelId.includes("4-") || modelId.includes("4-5")) &&
			budget_tokens !== 0
		)

		switch (modelId) {
			// 'latest' alias does not support cache_control
			case "claude-haiku-4-5-20251001":
			case "claude-sonnet-4-5-20250929:1m":
			case "claude-sonnet-4-5-20250929":
			case "claude-sonnet-4-20250514":
			case "claude-3-7-sonnet-20250219":
			case "claude-3-5-sonnet-20241022":
			case "claude-3-5-haiku-20241022":
			case "claude-opus-4-20250514":
			case "claude-opus-4-1-20250805":
			case "claude-3-opus-20240229":
			case "claude-3-haiku-20240307": {
				/*
				The latest message will be the new user message, one before will be the assistant message from a previous request, and the user message before that will be a previously cached user message. So we need to mark the latest user message as ephemeral to cache it for the next request, and mark the second to last user message as ephemeral to let the server know the last message to retrieve from the cache for the current request..
				*/
				const userMsgIndices = messages.reduce((acc, msg, index) => {
					if (msg.role === "user") {
						acc.push(index)
					}
					return acc
				}, [] as number[])
				const lastUserMsgIndex = userMsgIndices[userMsgIndices.length - 1] ?? -1
				const secondLastMsgUserIndex = userMsgIndices[userMsgIndices.length - 2] ?? -1

				const anthropicMessages = sanitizeAnthropicMessages(messages, lastUserMsgIndex, secondLastMsgUserIndex)

				stream = await client.messages.create(
					{
						model: modelId,
						thinking: reasoningOn ? { type: "enabled", budget_tokens: budget_tokens } : undefined,
						max_tokens: model.info.maxTokens || 8192,
						// "Thinking isn’t compatible with temperature, top_p, or top_k modifications as well as forced tool use."
						// (https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking#important-considerations-when-using-extended-thinking)
						temperature: reasoningOn ? undefined : 0,
						system: [
							{
								text: systemPrompt,
								type: "text",
								cache_control: { type: "ephemeral" },
							},
						], // setting cache breakpoint for system prompt so new tasks can reuse it
						messages: anthropicMessages,
						// tools, // cache breakpoints go from tools > system > messages, and since tools dont change, we can just set the breakpoint at the end of system (this avoids having to set a breakpoint at the end of tools which by itself does not meet min requirements for haiku caching)
						stream: true,
						tools: nativeToolsOn ? (tools as AnthropicTool[]) : undefined,
						// tool_choice options:
						// - none: disables tool use, even if tools are provided. Claude will not call any tools.
						// - auto: allows Claude to decide whether to call any provided tools or not. This is the default value when tools are provided.
						// - any: tells Claude that it must use one of the provided tools, but doesn’t force a particular tool.
						// NOTE: Forcing tool use when tools are provided will result in error when thinking is also enabled.
						tool_choice: nativeToolsOn && !reasoningOn ? { type: "any" } : undefined,
					},
					(() => {
						// 1m context window beta header
						if (enable1mContextWindow) {
							return {
								headers: {
									"anthropic-beta": "context-1m-2025-08-07",
								},
							}
						} else {
							return undefined
						}
					})(),
				)
				break
			}
			default: {
				stream = await client.messages.create({
					model: modelId,
					max_tokens: model.info.maxTokens || 8192,
					temperature: 0,
					system: [{ text: systemPrompt, type: "text" }],
					messages: sanitizeAnthropicMessages(messages),
					// tools,
					// tool_choice: { type: "auto" },
					stream: true,
				})
				break
			}
		}

		let thinkingDeltaAccumulator = ""
		const lastStartedToolCall = { id: "", name: "", arguments: "" }

		for await (const chunk of stream) {
			switch (chunk?.type) {
				case "message_start":
					// tells us cache reads/writes/input/output
					const usage = chunk.message.usage
					yield {
						type: "usage",
						inputTokens: usage.input_tokens || 0,
						outputTokens: usage.output_tokens || 0,
						cacheWriteTokens: usage.cache_creation_input_tokens || undefined,
						cacheReadTokens: usage.cache_read_input_tokens || undefined,
					}
					break
				case "message_delta":
					// tells us stop_reason, stop_sequence, and output tokens along the way and at the end of the message

					yield {
						type: "usage",
						inputTokens: 0,
						outputTokens: chunk.usage.output_tokens || 0,
					}
					break
				case "message_stop":
					// no usage data, just an indicator that the message is done
					break
				case "content_block_start":
					switch (chunk.content_block.type) {
						case "thinking":
							yield {
								type: "reasoning",
								reasoning: chunk.content_block.thinking || "",
							}
							const thinking = chunk.content_block.thinking
							const signature = chunk.content_block.signature
							if (thinking && signature) {
								yield {
									type: "ant_thinking",
									thinking,
									signature,
								}
							}
							break
						case "redacted_thinking":
							// Content is encrypted, and we don't to pass placeholder text back to the API
							yield {
								type: "reasoning",
								reasoning: "[Redacted thinking block]",
							}
							yield {
								type: "ant_redacted_thinking",
								data: chunk.content_block.data,
							}
							break
						case "tool_use":
							if (chunk.content_block.id && chunk.content_block.name) {
								// Convert Anthropic tool_use to OpenAI-compatible format
								lastStartedToolCall.id = chunk.content_block.id
								lastStartedToolCall.name = chunk.content_block.name
								lastStartedToolCall.arguments = ""
							}
							break
						case "text":
							// we may receive multiple text blocks, in which case just insert a line break between them
							if (chunk.index > 0) {
								yield {
									type: "text",
									text: "\n",
								}
							}
							yield {
								type: "text",
								text: chunk.content_block.text,
							}
							break
					}
					break
				case "content_block_delta":
					switch (chunk.delta.type) {
						case "thinking_delta":
							// 'reasoning' type just displays in the UI, but ant_thinking will be used to send the thinking traces back to the API
							yield {
								type: "reasoning",
								reasoning: chunk.delta.thinking,
							}
							thinkingDeltaAccumulator += chunk.delta.thinking
							break
						case "signature_delta":
							// It's used when sending the thinking block back to the API
							// API expects this in completed form, not as array of deltas
							if (thinkingDeltaAccumulator && chunk.delta.signature) {
								yield {
									type: "ant_thinking",
									thinking: thinkingDeltaAccumulator,
									signature: chunk.delta.signature,
								}
							}
							break
						case "text_delta":
							yield {
								type: "text",
								text: chunk.delta.text,
							}
							break
						case "input_json_delta":
							if (lastStartedToolCall.id && lastStartedToolCall.name && chunk.delta.partial_json) {
								// 	// Convert Anthropic tool_use to OpenAI-compatible format
								yield {
									type: "tool_calls",
									tool_call: {
										...lastStartedToolCall,
										function: {
											...lastStartedToolCall,
											id: lastStartedToolCall.id,
											name: lastStartedToolCall.name,
											arguments: chunk.delta.partial_json,
										},
									},
								}
							}
							break
					}
					break

				case "content_block_stop":
					lastStartedToolCall.id = ""
					lastStartedToolCall.name = ""
					lastStartedToolCall.arguments = ""
					break
			}
		}
	}

	getModel(): { id: AnthropicModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in anthropicModels) {
			const id = modelId as AnthropicModelId
			return { id, info: anthropicModels[id] }
		}
		return {
			id: anthropicDefaultModelId,
			info: anthropicModels[anthropicDefaultModelId],
		}
	}
}
