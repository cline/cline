import { Anthropic } from "@anthropic-ai/sdk"
import { ApiHandler } from "."
import { ApiHandlerOptions } from "../shared/api"

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
				model: "claude-3-5-sonnet-20240620", // https://docs.anthropic.com/en/docs/about-claude/models
				max_tokens: 8192, // beta max tokens
				system: systemPrompt,
				messages,
				tools,
				tool_choice: { type: "auto" },
			},
			{
				// https://github.com/anthropics/anthropic-sdk-typescript?tab=readme-ov-file#default-headers
				headers: { "anthropic-beta": "max-tokens-3-5-sonnet-2024-07-15" },
			}
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
			model: "claude-3-5-sonnet-20240620",
			max_tokens: 8192,
			system: "(see SYSTEM_PROMPT in src/ClaudeDev.ts)",
			messages: [{ conversation_history: "..." }, { role: "user", content: userContent }],
			tools: "(see tools in src/ClaudeDev.ts)",
			tool_choice: { type: "auto" },
		}
	}
}
