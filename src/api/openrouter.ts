import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { ApiHandler, ApiHandlerMessageResponse, withoutImageData } from "."
import {
	ApiHandlerOptions,
	ModelInfo,
	openRouterDefaultModelId,
	OpenRouterModelId,
	openRouterModels,
} from "../shared/api"
import { convertToOpenAiMessages } from "../utils/openai-format"

export class OpenRouterHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: OpenAI

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new OpenAI({
			baseURL: "https://openrouter.ai/api/v1",
			apiKey: this.options.openRouterApiKey,
			defaultHeaders: {
				"HTTP-Referer": "https://github.com/saoudrizwan/claude-dev", // Optional, for including your app on openrouter.ai rankings.
				"X-Title": "claude-dev", // Optional. Shows in rankings on openrouter.ai.
			},
		})
	}

	async createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		tools: Anthropic.Messages.Tool[]
	): Promise<ApiHandlerMessageResponse> {
		// Convert Anthropic messages to OpenAI format
		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		// Convert Anthropic tools to OpenAI tools
		const openAiTools: OpenAI.Chat.ChatCompletionTool[] = tools.map((tool) => ({
			type: "function",
			function: {
				name: tool.name,
				description: tool.description,
				parameters: tool.input_schema, // matches anthropic tool input schema (see https://platform.openai.com/docs/guides/function-calling)
			},
		}))

		const createParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
			model: this.getModel().id,
			max_tokens: this.getModel().info.maxTokens,
			messages: openAiMessages,
			tools: openAiTools,
			tool_choice: "auto",
		}

		let completion: OpenAI.Chat.Completions.ChatCompletion
		try {
			completion = await this.client.chat.completions.create(createParams)
		} catch (error) {
			console.error("Error creating message from normal request. Using streaming fallback...", error)
			completion = await this.streamCompletion(createParams)
		}

		const errorMessage = (completion as any).error?.message // openrouter returns an error object instead of the openai sdk throwing an error
		if (errorMessage) {
			throw new Error(errorMessage)
		}

		// Convert OpenAI response to Anthropic format
		const openAiMessage = completion.choices[0].message
		const anthropicMessage: Anthropic.Messages.Message = {
			id: completion.id,
			type: "message",
			role: openAiMessage.role, // always "assistant"
			content: [
				{
					type: "text",
					text: openAiMessage.content || "",
				},
			],
			model: completion.model,
			stop_reason: (() => {
				switch (completion.choices[0].finish_reason) {
					case "stop":
						return "end_turn"
					case "length":
						return "max_tokens"
					case "tool_calls":
						return "tool_use"
					case "content_filter": // Anthropic doesn't have an exact equivalent
					default:
						return null
				}
			})(),
			stop_sequence: null, // which custom stop_sequence was generated, if any (not applicable if you don't use stop_sequence)
			usage: {
				input_tokens: completion.usage?.prompt_tokens || 0,
				output_tokens: completion.usage?.completion_tokens || 0,
			},
		}

		if (openAiMessage.tool_calls && openAiMessage.tool_calls.length > 0) {
			anthropicMessage.content.push(
				...openAiMessage.tool_calls.map((toolCall): Anthropic.ToolUseBlock => {
					let parsedInput = {}
					try {
						parsedInput = JSON.parse(toolCall.function.arguments || "{}")
					} catch (error) {
						console.error("Failed to parse tool arguments:", error)
					}
					return {
						type: "tool_use",
						id: toolCall.id,
						name: toolCall.function.name,
						input: parsedInput,
					}
				})
			)
		}

		return { message: anthropicMessage }
	}

	/*
	Streaming the completion is a fallback behavior for when a normal request responds with an invalid JSON object ("Unexpected end of JSON input"). This would usually happen in cases where the model makes tool calls with large arguments. After talking with OpenRouter folks, streaming mitigates this issue for now until they fix the underlying problem ("some weird data from anthropic got decoded wrongly and crashed the buffer")
	*/
	async streamCompletion(
		createParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
	): Promise<OpenAI.Chat.Completions.ChatCompletion> {
		const stream = await this.client.chat.completions.create({
			...createParams,
			stream: true,
		})

		let textContent: string = ""
		let toolCalls: OpenAI.Chat.ChatCompletionMessageToolCall[] = []

		try {
			let currentToolCall: (OpenAI.Chat.ChatCompletionMessageToolCall & { index?: number }) | null = null
			for await (const chunk of stream) {
				const delta = chunk.choices[0]?.delta
				if (delta?.content) {
					textContent += delta.content
				}
				if (delta?.tool_calls) {
					for (const toolCallDelta of delta.tool_calls) {
						if (toolCallDelta.index === undefined) {
							continue
						}
						if (!currentToolCall || currentToolCall.index !== toolCallDelta.index) {
							// new index means new tool call, so add the previous one to the list
							if (currentToolCall) {
								toolCalls.push(currentToolCall)
							}
							currentToolCall = {
								index: toolCallDelta.index,
								id: toolCallDelta.id || "",
								type: "function",
								function: { name: "", arguments: "" },
							}
						}
						if (toolCallDelta.id) {
							currentToolCall.id = toolCallDelta.id
						}
						if (toolCallDelta.type) {
							currentToolCall.type = toolCallDelta.type
						}
						if (toolCallDelta.function) {
							if (toolCallDelta.function.name) {
								currentToolCall.function.name = toolCallDelta.function.name
							}
							if (toolCallDelta.function.arguments) {
								currentToolCall.function.arguments =
									(currentToolCall.function.arguments || "") + toolCallDelta.function.arguments
							}
						}
					}
				}
			}
			if (currentToolCall) {
				toolCalls.push(currentToolCall)
			}
		} catch (error) {
			console.error("Error streaming completion:", error)
			throw error
		}

		// Usage information is not available in streaming responses, so we need to estimate token counts
		function approximateTokenCount(text: string): number {
			return Math.ceil(new TextEncoder().encode(text).length / 4)
		}
		const promptTokens = approximateTokenCount(
			createParams.messages
				.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
				.join(" ")
		)
		const completionTokens = approximateTokenCount(
			textContent + toolCalls.map((toolCall) => toolCall.function.arguments || "").join(" ")
		)

		const completion: OpenAI.Chat.Completions.ChatCompletion = {
			created: Date.now(),
			object: "chat.completion",
			id: `openrouter-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`, // this ID won't be traceable back to OpenRouter's systems if you need to debug issues
			choices: [
				{
					message: {
						role: "assistant",
						content: textContent,
						tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
					},
					finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop",
					index: 0,
					logprobs: null,
				},
			],
			model: this.getModel().id,
			usage: {
				prompt_tokens: promptTokens,
				completion_tokens: completionTokens,
				total_tokens: promptTokens + completionTokens,
			},
		}

		return completion
	}

	createUserReadableRequest(
		userContent: Array<
			| Anthropic.TextBlockParam
			| Anthropic.ImageBlockParam
			| Anthropic.ToolUseBlockParam
			| Anthropic.ToolResultBlockParam
		>
	): any {
		return {
			model: this.getModel().id,
			max_tokens: this.getModel().info.maxTokens,
			system: "(see SYSTEM_PROMPT in src/ClaudeDev.ts)",
			messages: [{ conversation_history: "..." }, { role: "user", content: withoutImageData(userContent) }],
			tools: "(see tools in src/ClaudeDev.ts)",
			tool_choice: "auto",
		}
	}

	getModel(): { id: OpenRouterModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in openRouterModels) {
			const id = modelId as OpenRouterModelId
			return { id, info: openRouterModels[id] }
		}
		return { id: openRouterDefaultModelId, info: openRouterModels[openRouterDefaultModelId] }
	}
}
