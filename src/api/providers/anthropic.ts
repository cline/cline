import { Anthropic } from "@anthropic-ai/sdk"
import { Stream as AnthropicStream } from "@anthropic-ai/sdk/streaming"
import { anthropicDefaultModelId, AnthropicModelId, anthropicModels, ModelInfo } from "../../shared/api"
import { ApiStream } from "../transform/stream"
import { EnterpriseHandler } from "./enterprise"
import { RawMessageStreamEvent } from "@anthropic-ai/sdk/resources/messages.mjs"

export class AnthropicHandler extends EnterpriseHandler<Anthropic> {
	override getClient() {
		return new Anthropic({
			apiKey: this.options.apiKey,
			baseURL: this.options.anthropicBaseUrl || "https://api.anthropic.com",
		})
	}

	override async *createEnterpriseMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const model = this.getModel()
		const modelId = model.id

		let stream: AnthropicStream<Anthropic.Beta.PromptCaching.Messages.RawPromptCachingBetaMessageStreamEvent>

		if (Object.keys(anthropicModels).includes(modelId)) {
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

	override async createEnterpriseModelStream(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		modelId: string,
		maxTokens: number,
	): Promise<AnthropicStream<Anthropic.Beta.PromptCaching.Messages.RawPromptCachingBetaMessageStreamEvent>> {
		/*
		The latest message will be the new user message, one before will be the assistant message from a previous request, and the user message before that will be a previously cached user message. So we need to mark the latest user message as ephemeral to cache it for the next request, and mark the second to last user message as ephemeral to let the server know the last message to retrieve from the cache for the current request..
		*/
		const userMsgIndices = messages.reduce((acc, msg, index) => (msg.role === "user" ? [...acc, index] : acc), [] as number[])
		const lastUserMsgIndex = userMsgIndices[userMsgIndices.length - 1] ?? -1
		const secondLastMsgUserIndex = userMsgIndices[userMsgIndices.length - 2] ?? -1
		return await this.client.beta.promptCaching.messages.create(
			{
				model: modelId,
				max_tokens: maxTokens || 8192,
				temperature: 0,
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
				// tools, // cache breakpoints go from tools > system > messages, and since tools dont change, we can just set the breakpoint at the end of system (this avoids having to set a breakpoint at the end of tools which by itself does not meet min requirements for haiku caching)
				// tool_choice: { type: "auto" },
				// tools: tools,
				stream: true,
			},
			{ headers: { "anthropic-beta": "prompt-caching-2024-07-31" } },
		)
	}

	override async *processChunk(chunk: Anthropic.Messages.RawMessageStreamEvent) {
		switch (chunk.type) {
			case "message_start":
				// tells us cache reads/writes/input/output
				const usage = chunk.message.usage
				yield {
					type: "usage",
					inputTokens: usage.input_tokens || 0,
					outputTokens: usage.output_tokens || 0,
				}
				break
			case "message_delta":
				// tells us stop_reason, stop_sequence, and output tokens along the way and at the end of the message

				yield {
					type: "usage",
					inputTokens: 0,
					outputTokens: chunk.usage.output_tokens || 0,
				}
				break
			case "message_stop":
				// no usage data, just an indicator that the message is done
				break
			case "content_block_start":
				switch (chunk.content_block.type) {
					case "text":
						// we may receive multiple text blocks, in which case just insert a line break between them
						if (chunk.index > 0) {
							yield {
								type: "text",
								text: "\n",
							}
						}
						yield {
							type: "text",
							text: chunk.content_block.text,
						}
						break
				}
				break
			case "content_block_delta":
				switch (chunk.delta.type) {
					case "text_delta":
						yield {
							type: "text",
							text: chunk.delta.text,
						}
						break
				}
				break
			case "content_block_stop":
				break
		}
	}

	override getModel(): { id: AnthropicModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in anthropicModels) {
			const id = modelId as AnthropicModelId
			return { id, info: anthropicModels[id] }
		}
		return {
			id: anthropicDefaultModelId,
			info: anthropicModels[anthropicDefaultModelId],
		}
	}
}
