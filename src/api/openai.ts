import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI, { AzureOpenAI } from "openai"
import { ApiHandler, ApiHandlerMessageResponse } from "."
import { ApiHandlerOptions, ModelInfo, openAiModelInfoSaneDefaults } from "../shared/api"
import { convertToAnthropicMessage, convertToOpenAiMessages } from "../utils/openai-format"

export class OpenAiHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: OpenAI

	constructor(options: ApiHandlerOptions) {
		this.options = options
		// Azure API shape slightly differs from the core API shape: https://github.com/openai/openai-node?tab=readme-ov-file#microsoft-azure-openai
		if (this.options.openAiBaseUrl?.toLowerCase().includes("azure.com")) {
			this.client = new AzureOpenAI({
				baseURL: this.options.openAiBaseUrl,
				apiKey: this.options.openAiApiKey,
				// https://learn.microsoft.com/en-us/azure/ai-services/openai/api-version-deprecation
				// https://learn.microsoft.com/en-us/azure/ai-services/openai/reference#api-specs
				// (make sure to update API options placeholder)
				apiVersion: this.options.azureApiVersion || "2024-08-01-preview",
			})
		} else {
			this.client = new OpenAI({
				baseURL: this.options.openAiBaseUrl,
				apiKey: this.options.openAiApiKey,
			})
		}
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
		const createParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
			model: this.options.openAiModelId ?? "",
			messages: openAiMessages,
			temperature: 0.2,
			tools: openAiTools,
			tool_choice: "auto",
		}
		const completion = await this.client.chat.completions.create(createParams)
		const errorMessage = (completion as any).error?.message
		if (errorMessage) {
			throw new Error(errorMessage)
		}
		const anthropicMessage = convertToAnthropicMessage(completion)
		return { message: anthropicMessage }
	}

	getModel(): { id: string; info: ModelInfo } {
		return {
			id: this.options.openAiModelId ?? "",
			info: openAiModelInfoSaneDefaults,
		}
	}
}
