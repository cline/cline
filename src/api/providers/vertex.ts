import { AnthropicVertex } from "@anthropic-ai/vertex-sdk"
import { Anthropic } from "@anthropic-ai/sdk"
import { ApiHandler, ApiHandlerMessageResponse } from "../"
import { ApiHandlerOptions, ModelInfo, vertexDefaultModelId, VertexModelId, vertexModels } from "../../shared/api"

// https://docs.anthropic.com/en/api/claude-on-vertex-ai
export class VertexHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: AnthropicVertex

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new AnthropicVertex({
			projectId: this.options.vertexProjectId,
			// https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude#regions
			region: this.options.vertexRegion,
		})
	}

	async createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		tools: Anthropic.Messages.Tool[]
	): Promise<ApiHandlerMessageResponse> {
		const message = await this.client.messages.create({
			model: this.getModel().id,
			max_tokens: this.getModel().info.maxTokens,
			temperature: 0.2,
			system: systemPrompt,
			messages,
			tools,
			tool_choice: { type: "auto" },
		})
		return { message }
	}

	getModel(): { id: VertexModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in vertexModels) {
			const id = modelId as VertexModelId
			return { id, info: vertexModels[id] }
		}
		return { id: vertexDefaultModelId, info: vertexModels[vertexDefaultModelId] }
	}
}
