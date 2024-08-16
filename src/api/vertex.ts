import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import { Anthropic } from "@anthropic-ai/sdk";
import { ApiHandler, withoutImageData } from ".";
import { ApiHandlerOptions, ModelInfo, vertexDefaultModelId, VertexModelId, vertexModels } from "../shared/api";
import { GoogleAuth } from "google-auth-library";

// https://docs.anthropic.com/en/api/claude-on-vertex-ai
export class VertexHandler implements ApiHandler {
	private options: ApiHandlerOptions;
	private client: AnthropicVertex;

	constructor(options: ApiHandlerOptions) {
		this.options = options;
		this.client = new AnthropicVertex({
			googleAuth: this.options.gcServiceAccountKey
				? new GoogleAuth({
					credentials: JSON.parse(atob(this.options.gcServiceAccountKey)),
					scopes: 'https://www.googleapis.com/auth/cloud-platform'
				})
				: undefined,
			projectId: this.options.gcProjectId,
			// Provide valid region for the model you are using.
			// See also: https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude#regions
			region: this.options.gcRegion,
		});
	}

	async createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		tools: Anthropic.Messages.Tool[]
	): Promise<Anthropic.Messages.Message> {
		return await this.client.messages.create({
			model: this.getModel().id,
			max_tokens: this.getModel().info.maxTokens,
			system: systemPrompt,
			messages,
			tools,
			tool_choice: { type: "auto" },
		});
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
		};
	}

	getModel(): { id: VertexModelId; info: ModelInfo; } {
		const modelId = this.options.apiModelId;
		if (modelId && modelId in vertexModels) {
			const id = modelId as VertexModelId;
			return { id, info: vertexModels[id] };
		}
		return { id: vertexDefaultModelId, info: vertexModels[vertexDefaultModelId] };
	}
}
