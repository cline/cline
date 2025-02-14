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

		if (this.isNextGenModel(modelId)) {
			stream = await this.createNextGenModelStream(systemPrompt, messages, modelId, model.info.maxTokens ?? 8192)
		} else {
			stream = await this.createDefaultModelStream(systemPrompt, messages, modelId, model.info.maxTokens ?? 8192)
		}

		yield* this.processStream(stream)
	}

	private isNextGenModel(modelId: string): boolean {
		const specialModels = [
			"claude-3-5-sonnet-v2@20241022",
			"claude-3-sonnet@20240229",
			"claude-3-5-haiku@20241022",
			"claude-3-haiku@20240307",
			"claude-3-opus@20240229",
		]
		return specialModels.includes(modelId)
	}

	private async createNextGenModelStream(
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

	private transformMessage(
		message: Anthropic.Messages.MessageParam,
		index: number,
		lastUserMsgIndex: number,
		secondLastMsgUserIndex: number,
	): Anthropic.Messages.MessageParam {
		if (index === lastUserMsgIndex || index === secondLastMsgUserIndex) {
			return {
				...message,
				content:
					typeof message.content === "string"
						? [{ type: "text", text: message.content, cache_control: { type: "ephemeral" } }]
						: message.content.map((content, contentIndex) =>
								contentIndex === message.content.length - 1
									? { ...content, cache_control: { type: "ephemeral" } }
									: content,
							),
			}
		}
		return message
	}

	private async createDefaultModelStream(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		modelId: string,
		maxTokens: number,
	): Promise<AnthropicStream<RawMessageStreamEvent>> {
		return this.client.messages.create({
			model: modelId,
			max_tokens: maxTokens || 8192,
			temperature: 0,
			system: [{ text: systemPrompt, type: "text" }],
			messages,
			stream: true,
		}) as any
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
