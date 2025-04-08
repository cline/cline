import { MessageParam } from "@anthropic-ai/sdk/resources/index.mjs"
import {
	AzureOpenAiChatClient,
	AzureOpenAiChatCompletionRequestMessage,
	AzureOpenAiChatCompletionRequestMessageContentPartText,
	AzureOpenAiChatCompletionRequestSystemMessage,
	AzureOpenAiChatCompletionRequestSystemMessageContentPart,
	AzureOpenAiChatCompletionRequestToolMessageContentPart,
	AzureOpenAiChatCompletionRequestUserMessageContentPart,
} from "@sap-ai-sdk/foundation-models"
import { ApiHandler } from ".."
import { ApiHandlerOptions, ModelInfo, sapAiCoreDefaultModelId, sapAiCoreModels } from "../../shared/api"
import { ApiStream } from "../transform/stream"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import OpenAI from "openai"

export class SapAiCore implements ApiHandler {
	private options: ApiHandlerOptions

	constructor(options: ApiHandlerOptions) {
		this.options = options
	}

	/**
	 * Converts OpenAI message format to Azure OpenAI message format
	 * @param openAiMessages Messages in OpenAI format
	 * @returns Messages in Azure OpenAI format
	 */
	private convertToAICoreOpenAiMessages(
		openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[],
	): AzureOpenAiChatCompletionRequestMessage[] {
		return openAiMessages.map((message) => {
			// Handle different role types
			switch (message.role) {
				case "system":
					return {
						role: "system",
						content: message.content,
					}
				case "user":
					// For user messages, handle content parts
					if (Array.isArray(message.content)) {
						// Convert content parts to Azure format
						const aiCoreContent: AzureOpenAiChatCompletionRequestUserMessageContentPart[] = message.content
							.filter((part) => part.type === "text" || part.type === "image_url")
							.map((part) => {
								if (part.type === "text") {
									return {
										type: "text" as const,
										text: part.text,
									}
								} else if (part.type === "image_url") {
									return {
										type: "image_url" as const,
										image_url: {
											url: part.image_url.url,
											detail: part.image_url.detail || "auto",
										},
									}
								}
								// This should never happen due to the filter above
								throw new Error(`Unsupported content part type: ${(part as any).type}`)
							})

						return {
							role: "user",
							content: aiCoreContent,
							name: message.name,
						}
					}
					return {
						role: "user",
						content: message.content,
						name: message.name,
					}

				case "assistant":
					return {
						role: "assistant",
						content: typeof message.content === "string" ? message.content : "",
						name: message.name,
						tool_calls: message.tool_calls,
					}
				case "tool":
					if (Array.isArray(message.content)) {
						const aiCoreContent: AzureOpenAiChatCompletionRequestToolMessageContentPart[] = message.content.map(
							(part) => {
								return {
									type: "text" as const,
									text: part.text,
								}
							},
						)
						return {
							role: "tool",
							content: aiCoreContent,
							tool_call_id: message.tool_call_id,
						}
					}
					return {
						role: "tool",
						content: message.content,
						tool_call_id: message.tool_call_id,
					}
				default:
					// Default case - handle function and other roles
					if (message.role === "function") {
						return {
							role: "function",
							content: typeof message.content === "string" ? message.content : "",
							name: message.name || "function",
						}
					}
					// For any other roles, convert to system message as fallback
					return {
						role: "system",
						content: `${message.role}: ${typeof message.content === "string" ? message.content : ""}`,
					}
			}
		})
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: MessageParam[]): ApiStream {
		await this.mockAiCoreEnvVariable()
		const chatClient = new AzureOpenAiChatClient("gpt-4o")
		// Convert to OpenAI format first
		const openAImessages = [...convertToOpenAiMessages(messages)]
		// Then convert to AICore Azure OpenAI format
		const aiCoreSystemMessage: AzureOpenAiChatCompletionRequestSystemMessage = { role: "system", content: systemPrompt }
		const aiCoreMessages = [aiCoreSystemMessage, ...this.convertToAICoreOpenAiMessages(openAImessages)]
		// Use the AICore Azure-compatible messages
		const response = await chatClient.stream({
			messages: aiCoreMessages,
		})

		for await (const chunk of response.stream) {
			const delta = chunk.getDeltaContent()
			if (delta === null || delta === undefined) {
				continue
			}
			yield {
				type: "text",
				text: delta,
			}
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		return {
			id: sapAiCoreDefaultModelId,
			info: sapAiCoreModels[sapAiCoreDefaultModelId],
		}
	}

	async mockAiCoreEnvVariable(): Promise<void> {
		const aiCoreServiceCredentials = {
			clientid: "sb-0f46bebc-94b0-4fa0-83c0-b1b7b511b53b!b163757|xsuaa_std!b77089",
			clientsecret: "d845e971-294e-46d3-8ebe-71a7517207e8$2OSdrieVr_EdVTUqcKVEq0YE9huOAkWo2PcCT5LH5zY=",
			url: "https://yuv2-ai.authentication.sap.hana.ondemand.com",
			serviceurls: {
				AI_API_URL: "https://api.ai.internalprod.eu-central-1.aws.ml.hana.ondemand.com",
			},
		}
		process.env["AICORE_SERVICE_KEY"] = JSON.stringify(aiCoreServiceCredentials)
	}
}
