import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { ApiHandler, ApiHandlerMessageResponse, withoutImageData } from "."
import { ApiHandlerOptions, ModelInfo, openAiModelInfoSaneDefaults } from "../shared/api"
import { convertToAnthropicMessage, convertToOpenAiMessages } from "../utils/openai-format"

export class OllamaHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: OpenAI

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new OpenAI({
			baseURL: (this.options.ollamaBaseUrl || "http://localhost:11434") + "/v1",
			apiKey: "ollama",
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
		const createParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
			model: this.options.ollamaModelId ?? "",
			messages: openAiMessages,
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

	createUserReadableRequest(
		userContent: Array<
			| Anthropic.TextBlockParam
			| Anthropic.ImageBlockParam
			| Anthropic.ToolUseBlockParam
			| Anthropic.ToolResultBlockParam
		>
	): any {
		return {
			model: this.options.ollamaModelId ?? "",
			system: "(see SYSTEM_PROMPT in src/ClaudeDev.ts)",
			messages: [{ conversation_history: "..." }, { role: "user", content: withoutImageData(userContent) }],
			tools: "(see tools in src/ClaudeDev.ts)",
			tool_choice: "auto",
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		return {
			id: this.options.ollamaModelId ?? "",
			info: openAiModelInfoSaneDefaults,
		}
	}
}
