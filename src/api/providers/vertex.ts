import { Anthropic } from "@anthropic-ai/sdk"
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk"
import { Stream as AnthropicStream } from "@anthropic-ai/sdk/streaming"
import { EnterpriseHandler } from "./enterprise"
import { ApiHandlerOptions, ModelInfo, vertexDefaultModelId, VertexModelId, vertexModels } from "../../shared/api"
import { ApiStream } from "../transform/stream"
import { RawMessageStreamEvent } from "@anthropic-ai/sdk/resources/messages.mjs"

export class VertexHandler extends EnterpriseHandler {
	/**
	 * Initializes the AnthropicVertex client with projectId and region.
	 * @returns A promise that resolved when the client is initialized.
	 */
	async initialize() {
		return new AnthropicVertex({
			projectId: this.options.vertexProjectId,
			region: this.options.vertexRegion,
		})
	}

	async *createEnterpriseMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const model = this.getModel()
		const modelId = model.id
		let stream: AnthropicStream<RawMessageStreamEvent>

		if (this.isEnterpriseModel(modelId)) {
			stream = await this.createEnterpriseModelStream(systemPrompt, messages, modelId, model.info.maxTokens ?? 8192)
		} else {
			stream = this.client.messages.create({
				model: modelId,
				max_tokens: model.info.maxTokens || 8192,
				temperature: 0,
				system: [{ text: systemPrompt, type: "text" }],
				messages,
				stream: true,
			}) as any
		}

		yield* this.processStream(stream)
	}

	async createEnterpriseModelStream(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		modelId: string,
		maxTokens: number,
	): Promise<AnthropicStream<RawMessageStreamEvent>> {
		const userMsgIndices = messages.reduce((acc, msg, index) => (msg.role === "user" ? [...acc, index] : acc), [] as number[])
		const lastUserMsgIndex = userMsgIndices[userMsgIndices.length - 1] ?? -1
		const secondLastMsgUserIndex = userMsgIndices[userMsgIndices.length - 2] ?? -1

		return this.client.messages.create({
			model: modelId,
			max_tokens: maxTokens || 8192,
			temperature: 0,
			system: [{ text: systemPrompt, type: "text" }],
			messages: messages.map((message, index) =>
				this.transformMessage(message, index, lastUserMsgIndex, secondLastMsgUserIndex),
			),
			stream: true,
		})
	}

	async *processChunk(chunk: RawMessageStreamEvent): ApiStream {
		switch (chunk.type) {
			case "message": {
				return chunk.data
			}
			case "error": {
				throw new Error(chunk.data)
			}
			default: {
				throw new Error(`Unexpected chunk type: ${chunk.type}`)
			}
		}
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
