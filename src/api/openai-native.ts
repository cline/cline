import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { ApiHandler, ApiHandlerMessageResponse } from "."
import {
	ApiHandlerOptions,
	ModelInfo,
	openAiNativeDefaultModelId,
	OpenAiNativeModelId,
	openAiNativeModels,
} from "../shared/api"
import { convertToAnthropicMessage, convertToOpenAiMessages } from "../utils/openai-format"
import { convertO1ResponseToAnthropicMessage, convertToO1Messages } from "../utils/o1-format"

export class OpenAiNativeHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: OpenAI

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new OpenAI({
			apiKey: this.options.openAiNativeApiKey,
		})
	}

	async createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		tools: Anthropic.Messages.Tool[]
	): Promise<ApiHandlerMessageResponse> {
		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]
		const openAiTools: OpenAI.Chat.ChatCompletionTool[] = tools.map((tool) => ({
			type: "function",
			function: {
				name: tool.name,
				description: tool.description,
				parameters: tool.input_schema,
			},
		}))

		let createParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming

		switch (this.getModel().id) {
			case "o1-preview":
			case "o1-mini":
				createParams = {
					model: this.getModel().id,
					max_tokens: this.getModel().info.maxTokens,
					messages: convertToO1Messages(convertToOpenAiMessages(messages), systemPrompt),
				}
				break
			default:
				createParams = {
					model: this.getModel().id,
					max_tokens: this.getModel().info.maxTokens,
					messages: openAiMessages,
					tools: openAiTools,
					tool_choice: "auto",
				}
				break
		}

		const completion = await this.client.chat.completions.create(createParams)
		const errorMessage = (completion as any).error?.message
		if (errorMessage) {
			throw new Error(errorMessage)
		}

		let anthropicMessage: Anthropic.Messages.Message
		switch (this.getModel().id) {
			case "o1-preview":
			case "o1-mini":
				anthropicMessage = convertO1ResponseToAnthropicMessage(completion)
				break
			default:
				anthropicMessage = convertToAnthropicMessage(completion)
				break
		}

		return { message: anthropicMessage }
	}

	getModel(): { id: OpenAiNativeModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in openAiNativeModels) {
			const id = modelId as OpenAiNativeModelId
			return { id, info: openAiNativeModels[id] }
		}
		return { id: openAiNativeDefaultModelId, info: openAiNativeModels[openAiNativeDefaultModelId] }
	}
}
