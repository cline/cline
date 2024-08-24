import { Anthropic } from "@anthropic-ai/sdk"
import { ApiHandler, withoutImageData } from "."
import { ApiHandlerOptions, koduDefaultModelId, KoduModelId, koduModels, ModelInfo } from "../shared/api"
import axios from "axios"
import * as vscode from "vscode"

const KODU_BASE_URL = "https://claude-dev.com"

export function didClickKoduSignIn() {
	const loginUrl = `${KODU_BASE_URL}/auth/login?redirectTo=${vscode.env.uriScheme}://saoudrizwan.claude-dev&ext=1`
	vscode.env.openExternal(vscode.Uri.parse(loginUrl))
}

export function didClickKoduAddCredits() {
	const addCreditsUrl = `${KODU_BASE_URL}/user/addCredits?redirectTo=${vscode.env.uriScheme}://saoudrizwan.claude-dev&ext=1`
	vscode.env.openExternal(vscode.Uri.parse(addCreditsUrl))
}

export async function fetchKoduCredits({ apiKey }: { apiKey: string }) {
	const response = await axios.get(`${KODU_BASE_URL}/api/credits`, {
		headers: {
			"x-api-key": apiKey,
		},
	})
	return (response.data.credits as number) || 0
}

export class KoduHandler implements ApiHandler {
	private options: ApiHandlerOptions

	constructor(options: ApiHandlerOptions) {
		this.options = options
	}

	async createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		tools: Anthropic.Messages.Tool[]
	): Promise<Anthropic.Messages.Message> {
		const modelId = this.getModel().id
		let requestBody: Anthropic.Beta.PromptCaching.Messages.MessageCreateParamsNonStreaming
		switch (modelId) {
			case "claude-3-5-sonnet-20240620":
			case "claude-3-haiku-20240307":
				const userMsgIndices = messages.reduce(
					(acc, msg, index) => (msg.role === "user" ? [...acc, index] : acc),
					[] as number[]
				)
				const lastUserMsgIndex = userMsgIndices[userMsgIndices.length - 1] ?? -1
				const secondLastMsgUserIndex = userMsgIndices[userMsgIndices.length - 2] ?? -1
				requestBody = {
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
				}
				break
			default:
				requestBody = {
					model: modelId,
					max_tokens: this.getModel().info.maxTokens,
					system: [{ text: systemPrompt, type: "text" }],
					messages,
					tools,
					tool_choice: { type: "auto" },
				}
		}
		const response = await axios.post(`${KODU_BASE_URL}/api/inference`, requestBody, {
			headers: {
				"x-api-key": this.options.koduApiKey,
			},
		})
		return response.data
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

	getModel(): { id: KoduModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in koduModels) {
			const id = modelId as KoduModelId
			return { id, info: koduModels[id] }
		}
		return { id: koduDefaultModelId, info: koduModels[koduDefaultModelId] }
	}
}
