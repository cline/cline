import { Anthropic } from "@anthropic-ai/sdk"
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk"
import { Stream as AnthropicStream } from "@anthropic-ai/sdk/streaming"
import { EnterpriseHandler } from "./enterprise"
import { ModelInfo, vertexDefaultModelId, VertexModelId, vertexModels } from "../../shared/api"
import { ApiStream } from "../transform/stream"

/**
 * Handles interactions with the Anthropic Vertex service.
 */
export class VertexHandler extends EnterpriseHandler<AnthropicVertex> {
	override getClient() {
		return new AnthropicVertex({
			projectId: this.options.vertexProjectId,
			region: this.options.vertexRegion,
		})
	}

	async *createEnterpriseMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const model = this.getModel()
		const modelId = model.id
		let stream: AnthropicStream<Anthropic.Messages.RawMessageStreamEvent>

		if (Object.keys(vertexModels).includes(modelId)) {
			stream = await this.createEnterpriseModelStream(
				systemPrompt,
				messages,
				modelId,
				model.info.maxTokens ?? EnterpriseHandler.DEFAULT_TOKEN_SIZE,
			)
		} else {
			stream = this.client.messages.create({
				model: modelId,
				max_tokens: model.info.maxTokens || EnterpriseHandler.DEFAULT_TOKEN_SIZE,
				temperature: EnterpriseHandler.DEFAULT_TEMPERATURE,
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
	): Promise<AnthropicStream<Anthropic.Messages.RawMessageStreamEvent>> {
		const userMsgIndices = messages.reduce((acc, msg, index) => (msg.role === "user" ? [...acc, index] : acc), [] as number[])
		const lastUserMsgIndex = userMsgIndices[userMsgIndices.length - 1] ?? -1
		const secondLastMsgUserIndex = userMsgIndices[userMsgIndices.length - 2] ?? -1

		return this.client.messages.create({
			model: modelId,
			max_tokens: maxTokens || EnterpriseHandler.DEFAULT_TOKEN_SIZE,
			temperature: EnterpriseHandler.DEFAULT_TEMPERATURE,
			system: [
				{
					text: systemPrompt,
					type: "text",
					cache_control: { type: "ephemeral" },
				},
			], // setting cache breakpoint for system prompt so new tasks can reuse it
			messages: messages.map((message, index) =>
				this.transformMessage(message, index, lastUserMsgIndex, secondLastMsgUserIndex),
			),
			stream: true,
		})
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
