import { MessageParam } from "@anthropic-ai/sdk/resources/index.mjs"
import {
	AzureOpenAiChatClient,
	AzureOpenAiChatCompletionRequestMessage,
	AzureOpenAiChatCompletionRequestMessageContentPartText,
	AzureOpenAiChatCompletionRequestSystemMessage,
	AzureOpenAiChatCompletionRequestSystemMessageContentPart,
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
						const azureContent: AzureOpenAiChatCompletionRequestUserMessageContentPart[] = message.content
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
							content: azureContent,
							name: message.name,
						}
					} else {
						// String content
						return {
							role: "user",
							content: message.content || "",
							name: message.name,
						}
					}
				case "assistant":
					return {
						role: "assistant",
						content: typeof message.content === "string" ? message.content : "",
						name: message.name,
						tool_calls: message.tool_calls,
					}
				case "tool":
					return {
						role: "tool",
						content: typeof message.content === "string" ? message.content : "",
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
		// Then convert to Azure OpenAI format
		const azureMessages = this.convertToAICoreOpenAiMessages(openAImessages)
		// Use the Azure-compatible messages
		const response = await chatClient.stream({
			messages: azureMessages,
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
			clientid: "clientid",
			clientsecret: "clientsecret",
			url: "https://.authentication.sap.hana.ondemand.com",
			serviceurls: {
				AI_API_URL: "https://aws.ml.hana.ondemand.com",
			},
		}
		process.env["AICORE_SERVICE_KEY"] = JSON.stringify(aiCoreServiceCredentials)
	}
}
