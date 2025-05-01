import { ApiHandlerOptions, ModelInfo, VertexModelId, vertexDefaultModelId, vertexModels } from "@shared/api"
import { ApiHandler } from "../"
import { GeminiHandler } from "./gemini"

export class VertexHandler implements ApiHandler {
	private geminiHandler: GeminiHandler
	private options: ApiHandlerOptions

	constructor(options: ApiHandlerOptions) {
		this.options = options
		// Create a GeminiHandler with isVertex flag for Gemini models
		this.geminiHandler = new GeminiHandler({
			...options,
			isVertex: true,
		})
	}

	async *createMessage(systemPrompt: string, messages: any[]) {
		const model = this.getModel()
		const modelId = model.id

		// For Gemini models, use the GeminiHandler
		if (!modelId.includes("claude")) {
			// Delegate to geminiHandler for all Gemini models
			yield* this.geminiHandler.createMessage(systemPrompt, messages)
			return
		}

		// Your existing Claude implementation remains unchanged
		// This preserves your current Claude-specific functionality
		let budget_tokens = this.options.thinkingBudgetTokens || 0
		const reasoningOn = modelId.includes("3-7") && budget_tokens !== 0 ? true : false

		// ... rest of your existing Claude implementation ...
	}

	getModel(): { id: VertexModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in vertexModels) {
			const id = modelId as VertexModelId
			return { id, info: vertexModels[id] }
		}
		return {
			id: vertexDefaultModelId,
			info: vertexModels[vertexDefaultModelId],
		}
	}
}
