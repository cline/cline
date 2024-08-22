import { Anthropic } from "@anthropic-ai/sdk"
import { ApiHandler, withoutImageData } from "."
import { ApiHandlerOptions, maestroDefaultModelId, MaestroModelId, maestroModels, ModelInfo } from "../shared/api"

export class MaestroHandler implements ApiHandler {
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
						tools,
						tool_choice: { type: "auto" },
					},
					(() => {
						switch (modelId) {
							case "claude-3-5-sonnet-20240620":
								return {
									headers: {
										"anthropic-beta": "prompt-caching-2024-07-31",
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

	getModel(): { id: MaestroModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in maestroModels) {
			const id = modelId as MaestroModelId
			return { id, info: maestroModels[id] }
		}
		return { id: maestroDefaultModelId, info: maestroModels[maestroDefaultModelId] }
	}
}
