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
		return await this.client.messages.create(
			{
				model: this.getModel().id,
				max_tokens: this.getModel().info.maxTokens,
				system: systemPrompt,
				messages,
				tools,
				tool_choice: { type: "auto" },
			},
			// https://x.com/alexalbert__/status/1812921642143900036
			// https://github.com/anthropics/anthropic-sdk-typescript?tab=readme-ov-file#default-headers
			this.getModel().id === "claude-3-5-sonnet-20240620"
				? {
						headers: { "anthropic-beta": "max-tokens-3-5-sonnet-2024-07-15" },
				  }
				: undefined
		)
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
