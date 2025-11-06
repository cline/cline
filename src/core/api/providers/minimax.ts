import { Anthropic } from "@anthropic-ai/sdk"
import { Tool as AnthropicTool } from "@anthropic-ai/sdk/resources/index"
import { Stream as AnthropicStream } from "@anthropic-ai/sdk/streaming"
import { MinimaxModelId, ModelInfo, minimaxDefaultModelId, minimaxModels } from "@/shared/api"
import { fetch } from "@/shared/net"
import { ClineTool } from "@/shared/tools"
import { ApiHandler, CommonApiHandlerOptions } from "../index"
import { withRetry } from "../retry"
import { ApiStream } from "../transform/stream"

interface MinimaxHandlerOptions extends CommonApiHandlerOptions {
	minimaxApiKey?: string
	minimaxApiLine?: string
	apiModelId?: string
	thinkingBudgetTokens?: number
}

export class MinimaxHandler implements ApiHandler {
	private options: MinimaxHandlerOptions
	private client: Anthropic | undefined

	constructor(options: MinimaxHandlerOptions) {
		this.options = options
	}

	private ensureClient(): Anthropic {
		if (!this.client) {
			if (!this.options.minimaxApiKey) {
				throw new Error("MiniMax API key is required")
			}
			try {
				this.client = new Anthropic({
					apiKey: this.options.minimaxApiKey,
					baseURL:
						this.options.minimaxApiLine === "china"
							? "https://api.minimaxi.com/anthropic"
							: "https://api.minimax.io/anthropic",
					fetch, // Use configured fetch with proxy support
				})
			} catch (error) {
				throw new Error(`Error creating MiniMax client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[], tools?: ClineTool[]): ApiStream {
		const client = this.ensureClient()
		const model = this.getModel()

		// Tools are available only when native tools are enabled
		const nativeToolsOn = tools?.length && tools?.length > 0

		// MiniMax M2 uses Anthropic API format
		// Note: According to MiniMax docs, some Anthropic parameters like 'thinking' are ignored
		// but we'll include the standard Anthropic streaming pattern for consistency
		const stream: AnthropicStream<Anthropic.RawMessageStreamEvent> = await client.messages.create({
			model: model.id,
			max_tokens: model.info.maxTokens || 8192,
			temperature: 1.0, // MiniMax recommends 1.0, range is (0.0, 1.0]
			system: [{ text: systemPrompt, type: "text" }],
			messages,
			stream: true,
			tools: nativeToolsOn ? (tools as AnthropicTool[]) : undefined,
			tool_choice: nativeToolsOn ? { type: "any" } : undefined,
		})

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
							// Content is encrypted, and we don't want to pass placeholder text back to the API
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
								// Store tool call information for streaming
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
								// Convert Anthropic tool_use to OpenAI-compatible format for internal processing
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

	getModel(): { id: MinimaxModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId

		if (modelId && modelId in minimaxModels) {
			const id = modelId as MinimaxModelId
			return { id, info: minimaxModels[id] }
		}
		return { id: minimaxDefaultModelId, info: minimaxModels[minimaxDefaultModelId] }
	}
}
