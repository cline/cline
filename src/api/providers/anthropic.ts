import { Anthropic } from "@anthropic-ai/sdk"
import { Stream as AnthropicStream } from "@anthropic-ai/sdk/streaming"
import { anthropicDefaultModelId, AnthropicModelId, anthropicModels, ModelInfo } from "../../shared/api"
import { ApiStream } from "../transform/stream"
import { EnterpriseHandler } from "./enterprise"

/**
 * Handles interactions with the Anthropic service.
 */
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
			stream = await this.createEnterpriseModelStream(
				systemPrompt,
				messages,
				modelId,
				model.info.maxTokens ?? AnthropicHandler.DEFAULT_TOKEN_SIZE,
			)
		} else {
			stream = this.client.messages.create({
				model: modelId,
				max_tokens: model.info.maxTokens || AnthropicHandler.DEFAULT_TOKEN_SIZE,
				temperature: AnthropicHandler.DEFAULT_TEMPERATURE,
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
				max_tokens: maxTokens || AnthropicHandler.DEFAULT_TOKEN_SIZE,
				temperature: AnthropicHandler.DEFAULT_TEMPERATURE,
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
