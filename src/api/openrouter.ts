import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { ApiHandlerOptions } from "../shared/api"
import { ApiHandler } from "."

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
	): Promise<Anthropic.Messages.Message> {
		// Convert Anthropic messages to OpenAI format
		const openAIMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...messages.map((msg) => {
				const baseMessage = {
					content:
						typeof msg.content === "string"
							? msg.content
							: msg.content
									.map((part) => {
										if ("text" in part) {
											return part.text
										} else if ("source" in part) {
											return { type: "image_url" as const, image_url: { url: part.source.data } }
										}
										return ""
									})
									.filter(Boolean)
									.join("\n"),
				}

				if (msg.role === "user") {
					return { ...baseMessage, role: "user" as const }
				} else if (msg.role === "assistant") {
					const assistantMessage: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
						...baseMessage,
						role: "assistant" as const,
					}
					if ("tool_calls" in msg && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
						assistantMessage.tool_calls = msg.tool_calls.map((toolCall) => ({
							id: toolCall.id,
							type: "function",
							function: {
								name: toolCall.function.name,
								arguments: JSON.stringify(toolCall.function.arguments),
							},
						}))
					}
					return assistantMessage
				}
				throw new Error(`Unsupported message role: ${msg.role}`)
			}),
		]

		// Convert Anthropic tools to OpenAI tools
		const openAITools: OpenAI.Chat.ChatCompletionTool[] = tools.map((tool) => ({
			type: "function",
			function: {
				name: tool.name,
				description: tool.description,
				parameters: tool.input_schema,
			},
		}))

		const completion = await this.client.chat.completions.create({
			model: "anthropic/claude-3.5-sonnet:beta",
			max_tokens: 4096,
			messages: openAIMessages,
			tools: openAITools,
			tool_choice: "auto",
		})

		// Convert OpenAI response to Anthropic format
		const openAIMessage = completion.choices[0].message
		const anthropicMessage: Anthropic.Messages.Message = {
			id: completion.id,
			type: "message",
			role: "assistant",
			content: [
				{
					type: "text",
					text: openAIMessage.content || "",
				},
			],
			model: completion.model,
			stop_reason: this.mapFinishReason(completion.choices[0].finish_reason),
			stop_sequence: null,
			usage: {
				input_tokens: completion.usage?.prompt_tokens || 0,
				output_tokens: completion.usage?.completion_tokens || 0,
			},
		}

		if (openAIMessage.tool_calls && openAIMessage.tool_calls.length > 0) {
			anthropicMessage.content.push(
				...openAIMessage.tool_calls.map((toolCall) => ({
					type: "tool_use" as const,
					id: toolCall.id,
					name: toolCall.function.name,
					input: JSON.parse(toolCall.function.arguments || "{}"),
				}))
			)
		}

		return anthropicMessage
	}

	private mapFinishReason(
		finishReason: OpenAI.Chat.ChatCompletion.Choice["finish_reason"]
	): Anthropic.Messages.Message["stop_reason"] {
		switch (finishReason) {
			case "stop":
				return "end_turn"
			case "length":
				return "max_tokens"
			case "tool_calls":
				return "tool_use"
			case "content_filter":
				return null // Anthropic doesn't have an exact equivalent
			default:
				return null
		}
	}
}
