import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { ApiHandler, ApiHandlerMessageResponse } from "."
import {
	ApiHandlerOptions,
	ModelInfo,
	openRouterDefaultModelId,
	OpenRouterModelId,
	openRouterModels,
} from "../shared/api"
import { convertToAnthropicMessage, convertToOpenAiMessages } from "../utils/openai-format"
import axios from "axios"
import { convertO1ResponseToAnthropicMessage, convertToO1Messages } from "../utils/o1-format"

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

		// prompt caching: https://openrouter.ai/docs/prompt-caching
		switch (this.getModel().id) {
			case "anthropic/claude-3.5-sonnet:beta":
			case "anthropic/claude-3-haiku:beta":
			case "anthropic/claude-3-opus:beta":
				openAiMessages[0] = {
					role: "system",
					content: [
						{
							type: "text",
							text: systemPrompt,
							// @ts-ignore-next-line
							cache_control: { type: "ephemeral" },
						},
					],
				}
				// Add cache_control to the last two user messages
				const lastTwoUserMessages = openAiMessages.filter((msg) => msg.role === "user").slice(-2)
				lastTwoUserMessages.forEach((msg) => {
					if (typeof msg.content === "string") {
						msg.content = [{ type: "text", text: msg.content }]
					}
					if (Array.isArray(msg.content)) {
						let lastTextPart = msg.content.filter((part) => part.type === "text").pop()

						if (!lastTextPart) {
							lastTextPart = { type: "text", text: "..." }
							msg.content.push(lastTextPart)
						}
						// @ts-ignore-next-line
						lastTextPart["cache_control"] = { type: "ephemeral" }
					}
				})
				break
			default:
				break
		}

		// Convert Anthropic tools to OpenAI tools
		const openAiTools: OpenAI.Chat.ChatCompletionTool[] = tools.map((tool) => ({
			type: "function",
			function: {
				name: tool.name,
				description: tool.description,
				parameters: tool.input_schema, // matches anthropic tool input schema (see https://platform.openai.com/docs/guides/function-calling)
			},
		}))

		let createParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming

		switch (this.getModel().id) {
			case "openai/o1-preview":
			case "openai/o1-mini":
				createParams = {
					model: this.getModel().id,
					max_tokens: this.getModel().info.maxTokens,
					temperature: 0.2,
					messages: convertToO1Messages(convertToOpenAiMessages(messages), systemPrompt),
				}
				break
			default:
				createParams = {
					model: this.getModel().id,
					max_tokens: this.getModel().info.maxTokens,
					temperature: 0.2,
					messages: openAiMessages,
					tools: openAiTools,
					tool_choice: "auto",
				}
				break
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

		let anthropicMessage: Anthropic.Messages.Message
		switch (this.getModel().id) {
			case "openai/o1-preview":
			case "openai/o1-mini":
				anthropicMessage = convertO1ResponseToAnthropicMessage(completion)
				break
			default:
				anthropicMessage = convertToAnthropicMessage(completion)
				break
		}

		// Check if the model is Gemini Flash and remove extra escapes in tool result args
		// switch (this.getModel().id) {
		// 	case "google/gemini-pro-1.5":
		// 	case "google/gemini-flash-1.5":
		// 		const content = anthropicMessage.content
		// 		for (const block of content) {
		// 			if (
		// 				block.type === "tool_use" &&
		// 				typeof block.input === "object" &&
		// 				block.input !== null &&
		// 				"content" in block.input &&
		// 				typeof block.input.content === "string"
		// 			) {
		// 				block.input.content = unescapeGeminiContent(block.input.content)
		// 			}
		// 		}
		// 		break
		// 	default:
		// 		break
		// }

		const genId = completion.id
		// Log the generation details from OpenRouter API
		try {
			const response = await axios.get(`https://openrouter.ai/api/v1/generation?id=${genId}`, {
				headers: {
					Authorization: `Bearer ${this.options.openRouterApiKey}`,
				},
			})
			// @ts-ignore-next-line
			anthropicMessage.usage.total_cost = response.data?.data?.total_cost
			console.log("OpenRouter generation details:", response.data)
		} catch (error) {
			console.error("Error fetching OpenRouter generation details:", error)
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
						refusal: null,
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

	getModel(): { id: OpenRouterModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in openRouterModels) {
			const id = modelId as OpenRouterModelId
			return { id, info: openRouterModels[id] }
		}
		return { id: openRouterDefaultModelId, info: openRouterModels[openRouterDefaultModelId] }
	}
}
