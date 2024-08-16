import { Anthropic } from "@anthropic-ai/sdk"
import { ApiHandler, withoutImageData } from "."
import { anthropicDefaultModelId, AnthropicModelId, anthropicModels, ApiHandlerOptions, ModelInfo } from "../shared/api"

export class AnthropicHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: Anthropic

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new Anthropic({ apiKey: this.options.apiKey })
	}

	async createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		tools: Anthropic.Messages.Tool[]
	): Promise<Anthropic.Messages.Message> {
		const modelId = this.getModel().id
		switch (modelId) {
			case "claude-3-5-sonnet-20240620":
			case "claude-3-haiku-20240307":
				/*
				The latest message will be the new user message, one before will be the assistant message from a previous request, and the user message before that will be a previously cached user message. So we need to mark the latest user message as ephemeral to cache it for the next request, and mark the second to last user message as ephemeral to let the server know the last message to retrieve from the cache for the current request..
				*/
				const userMsgIndices = messages.reduce(
					(acc, msg, index) => (msg.role === "user" ? [...acc, index] : acc),
					[] as number[]
				)
				const lastUserMsgIndex = userMsgIndices[userMsgIndices.length - 1] ?? -1
				const secondLastMsgUserIndex = userMsgIndices[userMsgIndices.length - 2] ?? -1
				return await this.client.beta.promptCaching.messages.create(
					{
						model: modelId,
						max_tokens: this.getModel().info.maxTokens,
						system: [{ text: systemPrompt, type: "text", cache_control: { type: "ephemeral" } }],
						messages: messages.map((message, index) => {
							if (index === lastUserMsgIndex || index === secondLastMsgUserIndex) {
								return {
									...message,
									content:
										typeof message.content === "string"
											? [
													{
														type: "text",
														text: message.content,
														cache_control: { type: "ephemeral" },
													},
											  ]
											: message.content.map((content, contentIndex) =>
													contentIndex === message.content.length - 1
														? { ...content, cache_control: { type: "ephemeral" } }
														: content
											  ),
								}
							}
							return message
						}),
						tools, // cache breakpoints go from tools > system > messages, and since tools dont change, we can just set the breakpoint at the end of system (this avoids having to set a breakpoint at the end of tools which by itself does not meet min requirements for haiku caching)
						tool_choice: { type: "auto" },
					},
					(() => {
						// 8192 tokens: https://x.com/alexalbert__/status/1812921642143900036
						// prompt caching: https://x.com/alexalbert__/status/1823751995901272068
						// https://github.com/anthropics/anthropic-sdk-typescript?tab=readme-ov-file#default-headers
						// https://github.com/anthropics/anthropic-sdk-typescript/commit/c920b77fc67bd839bfeb6716ceab9d7c9bbe7393
						switch (modelId) {
							case "claude-3-5-sonnet-20240620":
								return {
									headers: {
										"anthropic-beta": "prompt-caching-2024-07-31,max-tokens-3-5-sonnet-2024-07-15",
									},
								}
							case "claude-3-haiku-20240307":
								return {
									headers: { "anthropic-beta": "prompt-caching-2024-07-31" },
								}
							default:
								return undefined
						}
					})()
				)
			default:
				return await this.client.messages.create({
					model: modelId,
					max_tokens: this.getModel().info.maxTokens,
					system: [{ text: systemPrompt, type: "text" }],
					messages,
					tools,
					tool_choice: { type: "auto" },
				})
		}
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
			tool_choice: { type: "auto" },
		}
	}

	getModel(): { id: AnthropicModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in anthropicModels) {
			const id = modelId as AnthropicModelId
			return { id, info: anthropicModels[id] }
		}
		return { id: anthropicDefaultModelId, info: anthropicModels[anthropicDefaultModelId] }
	}
}
