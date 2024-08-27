import { Anthropic } from "@anthropic-ai/sdk"
import axios from "axios"
import { ApiHandler, ApiHandlerMessageResponse, withoutImageData } from "."
import { ApiHandlerOptions, koduDefaultModelId, KoduModelId, koduModels, ModelInfo } from "../shared/api"
import { getKoduCreditsUrl, getKoduInferenceUrl } from "../shared/kodu"

export async function fetchKoduCredits({ apiKey }: { apiKey: string }) {
	const response = await axios.get(getKoduCreditsUrl(), {
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
	): Promise<ApiHandlerMessageResponse> {
		const modelId = this.getModel().id
		let requestBody: Anthropic.Beta.PromptCaching.Messages.MessageCreateParamsNonStreaming
		switch (modelId) {
			case "claude-3-5-sonnet-20240620":
			case "claude-3-opus-20240229":
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

		// const response = await axios.post(getKoduInferenceUrl(), requestBody, {
		// 	headers: {
		// 		"x-api-key": this.options.koduApiKey,
		// 	},
		// })
		// const message = response.data
		// const userCredits = response.headers["user-credits"]
		// return { message, userCredits: userCredits !== undefined ? parseFloat(userCredits) : undefined }
		// const thing = {
		// 	method: "POST",
		// 	headers: {
		// 		"Content-Type": "application/json",
		// 		"x-api-key": this.options.koduApiKey || "",
		// 	},
		// 	body: JSON.stringify(requestBody),
		// }

		const response = await axios.post(getKoduInferenceUrl(), requestBody, {
			headers: {
				"Content-Type": "application/json",
				"x-api-key": this.options.koduApiKey || "",
			},
			responseType: "stream",
		})

		if (response.data) {
			const reader = response.data
			const decoder = new TextDecoder("utf-8")
			let finalResponse: any = null
			let buffer = ""

			for await (const chunk of reader) {
				buffer += decoder.decode(chunk, { stream: true })
				const lines = buffer.split("\n\n")
				buffer = lines.pop() || ""

				for (const line of lines) {
					if (line.startsWith("data: ")) {
						const eventData = JSON.parse(line.slice(6))

						console.log("eventData", eventData)

						if (eventData.code === 0) {
							console.log("Health check received")
						} else if (eventData.code === 1) {
							finalResponse = eventData.body
							console.log("finalResponse", finalResponse)
							break
						} else if (eventData.code === -1) {
							throw new Error(`Error in SSE stream: ${JSON.stringify(eventData.json)}`)
						}
					}
				}

				if (finalResponse) {
					break
				}
			}

			if (!finalResponse) {
				throw new Error("No final response received from the SSE stream")
			}

			const message: {
				anthropic: Anthropic.Messages.Message
				internal: {
					userCredits: number
				}
			} = finalResponse
			console.log("message", message)
			return {
				message: message.anthropic,
				userCredits: message.internal?.userCredits,
			}
		} else {
			throw new Error("No response data received")
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

	getModel(): { id: KoduModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in koduModels) {
			const id = modelId as KoduModelId
			return { id, info: koduModels[id] }
		}
		return { id: koduDefaultModelId, info: koduModels[koduDefaultModelId] }
	}
}
