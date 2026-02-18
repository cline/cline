import { Anthropic } from "@anthropic-ai/sdk"
import { Tool as AnthropicTool } from "@anthropic-ai/sdk/resources/index"
import { Stream as AnthropicStream } from "@anthropic-ai/sdk/streaming"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import { ApiStream } from "../transform/stream"

export async function* handleAnthropicMessagesApiStreamResponse(
	stream: AnthropicStream<Anthropic.RawMessageStreamEvent>,
): ApiStream {
	const lastStartedToolCall = { id: "", name: "", arguments: "" }

	for await (const chunk of stream) {
		switch (chunk?.type) {
			case "message_start": {
				const usage = chunk.message.usage
				yield {
					type: "usage",
					inputTokens: usage.input_tokens || 0,
					outputTokens: usage.output_tokens || 0,
					cacheWriteTokens: usage.cache_creation_input_tokens || undefined,
					cacheReadTokens: usage.cache_read_input_tokens || undefined,
				}
				break
			}
			case "message_delta":
				yield {
					type: "usage",
					inputTokens: 0,
					outputTokens: chunk.usage.output_tokens || 0,
				}
				break
			case "message_stop":
				break
			case "content_block_start":
				switch (chunk.content_block.type) {
					case "thinking":
						yield {
							type: "reasoning",
							reasoning: chunk.content_block.thinking || "",
						}
						if (chunk.content_block.thinking && chunk.content_block.signature) {
							yield {
								type: "reasoning",
								reasoning: chunk.content_block.thinking,
								signature: chunk.content_block.signature,
							}
						}
						break
					case "redacted_thinking":
						// Content is encrypted, and we don't want to pass placeholder text back to the API
						yield {
							type: "reasoning",
							reasoning: "[Redacted thinking block]",
							redacted_data: chunk.content_block.data,
						}
						break
					case "tool_use":
						if (chunk.content_block.id && chunk.content_block.name) {
							lastStartedToolCall.id = chunk.content_block.id
							lastStartedToolCall.name = chunk.content_block.name
							lastStartedToolCall.arguments = ""
						}
						break
					case "text":
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
						yield {
							type: "reasoning",
							reasoning: chunk.delta.thinking,
						}
						break
					case "signature_delta":
						if (chunk.delta.signature) {
							yield {
								type: "reasoning",
								reasoning: "",
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

export function convertOpenAIToolsToAnthropicTools(tools?: OpenAITool[]): AnthropicTool[] | undefined {
	if (!tools || tools.length === 0) {
		return undefined
	}

	const anthropicTools = tools
		.filter((tool): tool is OpenAITool & { type: "function" } => tool?.type === "function" && !!tool.function?.name)
		.map((tool) => {
			const { function: fn } = tool
			const schemaSource = fn?.parameters && typeof fn.parameters === "object" ? { ...fn.parameters } : {}
			if (typeof (schemaSource as { type?: unknown }).type !== "string") {
				;(schemaSource as { type: string }).type = "object"
			}
			return {
				name: fn!.name,
				description: fn?.description,
				input_schema: schemaSource as AnthropicTool["input_schema"],
			}
		})
		.filter((tool) => !!tool)
		.map((tool) => {
			// Ensure description is undefined rather than empty string to avoid API validation issues
			return {
				...tool,
				description: tool.description || undefined,
			}
		})

	return anthropicTools.length > 0 ? anthropicTools : undefined
}
