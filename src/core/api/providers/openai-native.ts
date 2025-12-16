import { ModelInfo, OpenAiNativeModelId, openAiNativeDefaultModelId, openAiNativeModels } from "@shared/api"
import { calculateApiCostOpenAI } from "@utils/cost"
import OpenAI from "openai"
import type { ChatCompletionReasoningEffort, ChatCompletionTool } from "openai/resources/chat/completions"
import { Logger } from "@/services/logging/Logger"
import { ClineStorageMessage } from "@/shared/messages/content"
import { fetch } from "@/shared/net"
import { ApiHandler, CommonApiHandlerOptions } from "../"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { convertToOpenAIResponsesInput } from "../transform/openai-response-format"
import { ApiStream } from "../transform/stream"
import { getOpenAIToolParams, ToolCallProcessor } from "../transform/tool-call-processor"

interface OpenAiNativeHandlerOptions extends CommonApiHandlerOptions {
	openAiNativeApiKey?: string
	reasoningEffort?: string
	apiModelId?: string
}

export class OpenAiNativeHandler implements ApiHandler {
	private options: OpenAiNativeHandlerOptions
	private client: OpenAI | undefined

	constructor(options: OpenAiNativeHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.openAiNativeApiKey) {
				throw new Error("OpenAI API key is required")
			}
			try {
				this.client = new OpenAI({
					apiKey: this.options.openAiNativeApiKey,
					fetch, // Use configured fetch with proxy support
				})
			} catch (error: any) {
				throw new Error(`Error creating OpenAI client: ${error.message}`)
			}
		}
		return this.client
	}

	private async *yieldUsage(info: ModelInfo, usage: OpenAI.Completions.CompletionUsage | undefined): ApiStream {
		const inputTokens = usage?.prompt_tokens || 0 // sum of cache hits and misses
		const outputTokens = usage?.completion_tokens || 0
		const cacheReadTokens = usage?.prompt_tokens_details?.cached_tokens || 0
		const cacheWriteTokens = 0
		const totalCost = calculateApiCostOpenAI(info, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens)
		const nonCachedInputTokens = Math.max(0, inputTokens - cacheReadTokens - cacheWriteTokens)
		yield {
			type: "usage",
			inputTokens: nonCachedInputTokens,
			outputTokens: outputTokens,
			cacheWriteTokens: cacheWriteTokens,
			cacheReadTokens: cacheReadTokens,
			totalCost: totalCost,
		}
	}

	@withRetry()
	async *createMessage(
		systemPrompt: string,
		messages: ClineStorageMessage[],
		tools?: ChatCompletionTool[],
		useResponseFormat = false,
	): ApiStream {
		if (useResponseFormat) {
			yield* this.createResponseStream(systemPrompt, messages, tools)
		} else {
			yield* this.createCompletionStream(systemPrompt, messages, tools)
		}
	}

	private async *createCompletionStream(
		systemPrompt: string,
		messages: ClineStorageMessage[],
		tools?: ChatCompletionTool[],
	): ApiStream {
		const client = this.ensureClient()
		const model = this.getModel()
		const toolCallProcessor = new ToolCallProcessor()

		switch (model.id) {
			case "o1":
			case "o1-preview":
			case "o1-mini": {
				// o1 doesn't support streaming, non-1 temp, or system prompt
				const response = await client.chat.completions.create({
					model: model.id,
					messages: [{ role: "user", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
				})
				yield {
					type: "text",
					text: response.choices[0]?.message.content || "",
				}

				yield* this.yieldUsage(model.info, response.usage)

				break
			}
			case "o4-mini":
			case "o3":
			case "o3-mini": {
				const stream = await client.chat.completions.create({
					model: model.id,
					messages: [{ role: "developer", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
					stream: true,
					stream_options: { include_usage: true },
					reasoning_effort: (this.options.reasoningEffort as ChatCompletionReasoningEffort) || "medium",
				})

				for await (const chunk of stream) {
					const delta = chunk.choices[0]?.delta
					if (delta?.content) {
						yield {
							type: "text",
							text: delta.content,
						}
					}
					if (chunk.usage) {
						// Only last chunk contains usage
						yield* this.yieldUsage(model.info, chunk.usage)
					}
				}
				break
			}
			case "gpt-5-2025-08-07":
			case "gpt-5-mini-2025-08-07":
			case "gpt-5-nano-2025-08-07":
			case "gpt-5.1-2025-11-13":
			case "gpt-5.1-chat-latest":
			case "gpt-5.1": {
				const stream = await client.chat.completions.create({
					model: model.id,
					temperature: 1,
					messages: [{ role: "developer", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
					stream: true,
					stream_options: { include_usage: true },
					reasoning_effort: (this.options.reasoningEffort as ChatCompletionReasoningEffort) || "medium",
					...getOpenAIToolParams(tools),
				})

				for await (const chunk of stream) {
					const delta = chunk.choices[0]?.delta
					if (delta?.content) {
						yield {
							type: "text",
							text: delta.content,
						}
					}

					if (delta?.tool_calls) {
						try {
							yield* toolCallProcessor.processToolCallDeltas(delta.tool_calls)
						} catch (error) {
							console.error("Error processing tool call delta:", error, delta.tool_calls)
						}
					}

					if (chunk.usage) {
						// Only last chunk contains usage - stream is ending
						yield* this.yieldUsage(model.info, chunk.usage)
					}
				}
				break
			}
			default: {
				const stream = await client.chat.completions.create({
					model: model.id,
					// max_completion_tokens: this.getModel().info.maxTokens,
					temperature: 0,
					messages: [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
					stream: true,
					stream_options: { include_usage: true },
					...getOpenAIToolParams(tools),
				})

				for await (const chunk of stream) {
					const delta = chunk.choices[0]?.delta
					if (delta?.content) {
						yield {
							type: "text",
							text: delta.content,
						}
					}

					if (delta?.tool_calls) {
						yield* toolCallProcessor.processToolCallDeltas(delta.tool_calls)
					}

					if (chunk.usage) {
						// Only last chunk contains usage - stream is ending
						yield* this.yieldUsage(model.info, chunk.usage)
					}
				}
			}
		}
	}

	private async *createResponseStream(
		systemPrompt: string,
		messages: ClineStorageMessage[],
		tools?: ChatCompletionTool[],
	): ApiStream {
		const client = this.ensureClient()
		const model = this.getModel()

		// Convert messages to Responses API input format
		const input = convertToOpenAIResponsesInput(messages)

		// Convert ChatCompletion tools to Responses API format if provided
		const responseTools = tools
			?.filter((tool) => tool.type === "function")
			.map((tool: any) => ({
				type: "function" as const,
				name: tool.function.name,
				description: tool.function.description,
				parameters: tool.function.parameters,
				strict: tool.function.strict ?? true, // Responses API defaults to strict mode
			}))

		Logger.debug("OpenAI Responses Input: " + JSON.stringify(input))

		// const lastAssistantMessage = [...messages].reverse().find((msg) => msg.role === "assistant" && msg.id)
		// const previous_response_id = lastAssistantMessage?.id

		// Create the response using Responses API
		const stream = await client.responses.create({
			model: model.id,
			instructions: systemPrompt,
			input,
			stream: true,
			tools: responseTools,
			// previous_response_id,
			// store: true,
			reasoning: { effort: "medium", summary: "auto" },
			// include: ["reasoning.encrypted_content"],
		})

		// Process the response stream
		for await (const chunk of stream) {
			Logger.debug("OpenAI Responses Chunk: " + JSON.stringify(chunk))

			// Handle different event types from Responses API
			if (chunk.type === "response.output_item.added") {
				const item = chunk.item
				if (item.type === "function_call" && item.id) {
					yield {
						type: "tool_calls",
						id: item.id,
						tool_call: {
							call_id: item.call_id,
							function: {
								id: item.id,
								name: item.name,
								arguments: item.arguments,
							},
						},
					}
				}
				if (item.type === "reasoning" && item.encrypted_content && item.id) {
					yield {
						type: "reasoning",
						id: item.id,
						reasoning: "",
						redacted_data: item.encrypted_content,
					}
				}
			}
			if (chunk.type === "response.output_item.done") {
				const item = chunk.item
				if (item.type === "function_call") {
					yield {
						type: "tool_calls",
						id: item.id || item.call_id,
						tool_call: {
							call_id: item.call_id,
							function: {
								id: item.id,
								name: item.name,
								arguments: item.arguments,
							},
						},
					}
				}
				if (item.type === "reasoning") {
					yield {
						type: "reasoning",
						id: item.id,
						details: item.summary,
						reasoning: "",
					}
				}
			}
			if (chunk.type === "response.reasoning_summary_part.added") {
				yield {
					type: "reasoning",
					id: chunk.item_id,
					reasoning: chunk.part.text,
				}
			}
			if (chunk.type === "response.reasoning_summary_text.delta") {
				yield {
					type: "reasoning",
					id: chunk.item_id,
					reasoning: chunk.delta,
				}
			}
			if (chunk.type === "response.reasoning_summary_part.done") {
				yield {
					type: "reasoning",
					id: chunk.item_id,
					details: chunk.part,
					reasoning: "",
				}
			}
			if (chunk.type === "response.output_text.delta") {
				// Handle text content deltas
				if (chunk.delta) {
					yield {
						id: chunk.item_id,
						type: "text",
						text: chunk.delta,
					}
				}
			}
			if (chunk.type === "response.reasoning_text.delta") {
				// Handle reasoning content deltas
				if (chunk.delta) {
					yield {
						id: chunk.item_id,
						type: "reasoning",
						reasoning: chunk.delta,
					}
				}
			}
			if (chunk.type === "response.function_call_arguments.delta") {
				yield {
					type: "tool_calls",
					tool_call: {
						function: {
							id: chunk.item_id,
							name: chunk.item_id,
							arguments: chunk.delta,
						},
					},
				}
			}
			if (chunk.type === "response.function_call_arguments.done") {
				// Handle completed function call
				if (chunk.item_id && chunk.name && chunk.arguments) {
					yield {
						type: "tool_calls",
						tool_call: {
							function: {
								id: chunk.item_id,
								name: chunk.name,
								arguments: chunk.arguments,
							},
						},
					}
				}
			}

			if (
				chunk.type === "response.incomplete" &&
				chunk.response?.status === "incomplete" &&
				chunk.response?.incomplete_details?.reason === "max_output_tokens"
			) {
				console.log("Ran out of tokens")
				if (chunk.response?.output_text?.length > 0) {
					console.log("Partial output:", chunk.response.output_text)
				} else {
					console.log("Ran out of tokens during reasoning")
				}
			}

			if (chunk.type === "response.completed" && chunk.response?.usage) {
				// Handle usage information when response is complete
				const usage = chunk.response.usage
				const inputTokens = usage.input_tokens || 0
				const outputTokens = usage.output_tokens || 0
				const cacheReadTokens = usage.output_tokens_details?.reasoning_tokens || 0
				const cacheWriteTokens = usage.input_tokens_details?.cached_tokens || 0
				const totalTokens = usage.total_tokens || 0
				Logger.log(`Total tokens from Responses API usage: ${totalTokens}`)
				const totalCost = calculateApiCostOpenAI(model.info, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens)
				const nonCachedInputTokens = Math.max(0, inputTokens - cacheReadTokens - cacheWriteTokens)
				yield {
					type: "usage",
					inputTokens: nonCachedInputTokens,
					outputTokens: outputTokens,
					cacheWriteTokens: cacheWriteTokens,
					cacheReadTokens: cacheReadTokens,
					totalCost: totalCost,
					id: chunk.response.id,
				}
			}
		}
	}

	getModel(): { id: OpenAiNativeModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in openAiNativeModels) {
			const id = modelId as OpenAiNativeModelId
			return { id, info: openAiNativeModels[id] }
		}
		return {
			id: openAiNativeDefaultModelId,
			info: openAiNativeModels[openAiNativeDefaultModelId],
		}
	}
}
