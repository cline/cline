import { Anthropic } from "@anthropic-ai/sdk"
import { ApiHandlerOptions, ModelInfo, morphDefaultModelId, morphModels, MorphModelId } from "../../shared/api"
import { ApiHandler } from "../index"
import { ApiStream } from "../transform/stream"

export class MorphHandler implements ApiHandler {
	private options: ApiHandlerOptions

	constructor(options: ApiHandlerOptions) {
		this.options = options
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		throw new Error(
			"Morph is specialized for file editing only and cannot be used for general chat. Please select a different API provider for chat functionality."
		)
	}

	getModel(): { id: MorphModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in morphModels) {
			const id = modelId as MorphModelId
			return { id, info: morphModels[id] }
		}
		return {
			id: morphDefaultModelId,
			info: morphModels[morphDefaultModelId],
		}
	}
} 