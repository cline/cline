import { Anthropic } from "@anthropic-ai/sdk"
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk"
import { Stream as AnthropicStream } from "@anthropic-ai/sdk/streaming"
import { ApiHandler, SingleCompletionHandler } from "../"
import { BetaThinkingConfigParam } from "@anthropic-ai/sdk/resources/beta"
import { ApiHandlerOptions, ModelInfo, vertexDefaultModelId, VertexModelId, vertexModels } from "../../shared/api"
import { ApiStream } from "../transform/stream"

// Types for Vertex SDK

/**
 * Vertex API has specific limitations for prompt caching:
 * 1. Maximum of 4 blocks can have cache_control
 * 2. Only text blocks can be cached (images and other content types cannot)
 * 3. Cache control can only be applied to user messages, not assistant messages
 *
 * Our caching strategy:
 * - Cache the system prompt (1 block)
 * - Cache the last text block of the second-to-last user message (1 block)
 * - Cache the last text block of the last user message (1 block)
 * This ensures we stay under the 4-block limit while maintaining effective caching
 * for the most relevant context.
 */

interface VertexTextBlock {
	type: "text"
	text: string
	cache_control?: { type: "ephemeral" }
}

interface VertexImageBlock {
	type: "image"
	source: {
		type: "base64"
		media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"
		data: string
	}
}

type VertexContentBlock = VertexTextBlock | VertexImageBlock

interface VertexUsage {
	input_tokens?: number
	output_tokens?: number
	cache_creation_input_tokens?: number
	cache_read_input_tokens?: number
}

interface VertexMessage extends Omit<Anthropic.Messages.MessageParam, "content"> {
	content: string | VertexContentBlock[]
}

interface VertexMessageCreateParams {
	model: string
	max_tokens: number
	temperature: number
	system: string | VertexTextBlock[]
	messages: VertexMessage[]
	stream: boolean
}

interface VertexMessageResponse {
	content: Array<{ type: "text"; text: string }>
}

interface VertexMessageStreamEvent {
	type: "message_start" | "message_delta" | "content_block_start" | "content_block_delta"
	message?: {
		usage: VertexUsage
	}
	usage?: {
		output_tokens: number
	}
	content_block?:
		| {
				type: "text"
				text: string
		  }
		| {
				type: "thinking"
				thinking: string
		  }
	index?: number
	delta?:
		| {
				type: "text_delta"
				text: string
		  }
		| {
				type: "thinking_delta"
				thinking: string
		  }
}

// https://docs.anthropic.com/en/api/claude-on-vertex-ai
export class VertexHandler implements ApiHandler, SingleCompletionHandler {
	private options: ApiHandlerOptions
	private client: AnthropicVertex

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new AnthropicVertex({
			projectId: this.options.vertexProjectId ?? "not-provided",
			// https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude#regions
			region: this.options.vertexRegion ?? "us-east5",
		})
	}

	private formatMessageForCache(message: Anthropic.Messages.MessageParam, shouldCache: boolean): VertexMessage {
		// Assistant messages are kept as-is since they can't be cached
		if (message.role === "assistant") {
			return message as VertexMessage
		}

		// For string content, we convert to array format with optional cache control
		if (typeof message.content === "string") {
			return {
				...message,
				content: [
					{
						type: "text" as const,
						text: message.content,
						// For string content, we only have one block so it's always the last
						...(shouldCache && { cache_control: { type: "ephemeral" } }),
					},
				],
			}
		}

		// For array content, find the last text block index once before mapping
		const lastTextBlockIndex = message.content.reduce(
			(lastIndex, content, index) => (content.type === "text" ? index : lastIndex),
			-1,
		)

		// Then use this pre-calculated index in the map function
		return {
			...message,
			content: message.content.map((content, contentIndex) => {
				// Images and other non-text content are passed through unchanged
				if (content.type === "image") {
					return content as VertexImageBlock
				}

				// Check if this is the last text block using our pre-calculated index
				const isLastTextBlock = contentIndex === lastTextBlockIndex

				return {
					type: "text" as const,
					text: (content as { text: string }).text,
					...(shouldCache && isLastTextBlock && { cache_control: { type: "ephemeral" } }),
				}
			}),
		}
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const model = this.getModel()
		let { id, info, temperature, maxTokens, thinking } = model
		const useCache = model.info.supportsPromptCache

		// Find indices of user messages that we want to cache
		// We only cache the last two user messages to stay within the 4-block limit
		// (1 block for system + 1 block each for last two user messages = 3 total)
		const userMsgIndices = useCache
			? messages.reduce((acc, msg, i) => (msg.role === "user" ? [...acc, i] : acc), [] as number[])
			: []
		const lastUserMsgIndex = userMsgIndices[userMsgIndices.length - 1] ?? -1
		const secondLastMsgUserIndex = userMsgIndices[userMsgIndices.length - 2] ?? -1

		// Create the stream with appropriate caching configuration
		const params = {
			model: id,
			max_tokens: maxTokens,
			temperature,
			thinking,
			// Cache the system prompt if caching is enabled
			system: useCache
				? [
						{
							text: systemPrompt,
							type: "text" as const,
							cache_control: { type: "ephemeral" },
						},
					]
				: systemPrompt,
			messages: messages.map((message, index) => {
				// Only cache the last two user messages
				const shouldCache = useCache && (index === lastUserMsgIndex || index === secondLastMsgUserIndex)
				return this.formatMessageForCache(message, shouldCache)
			}),
			stream: true,
		}

		const stream = (await this.client.messages.create(
			params as Anthropic.Messages.MessageCreateParamsStreaming,
		)) as unknown as AnthropicStream<VertexMessageStreamEvent>

		// Process the stream chunks
		for await (const chunk of stream) {
			switch (chunk.type) {
				case "message_start": {
					const usage = chunk.message!.usage
					yield {
						type: "usage",
						inputTokens: usage.input_tokens || 0,
						outputTokens: usage.output_tokens || 0,
						cacheWriteTokens: usage.cache_creation_input_tokens,
						cacheReadTokens: usage.cache_read_input_tokens,
					}
					break
				}
				case "message_delta": {
					yield {
						type: "usage",
						inputTokens: 0,
						outputTokens: chunk.usage!.output_tokens || 0,
					}
					break
				}
				case "content_block_start": {
					switch (chunk.content_block!.type) {
						case "text": {
							if (chunk.index! > 0) {
								yield {
									type: "text",
									text: "\n",
								}
							}
							yield {
								type: "text",
								text: chunk.content_block!.text,
							}
							break
						}
						case "thinking": {
							if (chunk.index! > 0) {
								yield {
									type: "reasoning",
									text: "\n",
								}
							}
							yield {
								type: "reasoning",
								text: (chunk.content_block as any).thinking,
							}
							break
						}
					}
					break
				}
				case "content_block_delta": {
					switch (chunk.delta!.type) {
						case "text_delta": {
							yield {
								type: "text",
								text: chunk.delta!.text,
							}
							break
						}
						case "thinking_delta": {
							yield {
								type: "reasoning",
								text: (chunk.delta as any).thinking,
							}
							break
						}
					}
					break
				}
			}
		}
	}

	getModel(): {
		id: VertexModelId
		info: ModelInfo
		temperature: number
		maxTokens: number
		thinking?: BetaThinkingConfigParam
	} {
		const modelId = this.options.apiModelId
		let temperature = this.options.modelTemperature ?? 0
		let thinking: BetaThinkingConfigParam | undefined = undefined

		if (modelId && modelId in vertexModels) {
			const id = modelId as VertexModelId
			const info: ModelInfo = vertexModels[id]

			// The `:thinking` variant is a virtual identifier for thinking-enabled models
			// Similar to how it's handled in the Anthropic provider
			let actualId = id
			if (id.endsWith(":thinking")) {
				actualId = id.replace(":thinking", "") as VertexModelId
			}

			const maxTokens = this.options.modelMaxTokens || info.maxTokens || 8192

			if (info.thinking) {
				temperature = 1.0 // Thinking requires temperature 1.0
				const maxBudgetTokens = Math.floor(maxTokens * 0.8)
				const budgetTokens = Math.max(
					Math.min(
						this.options.vertexThinking ?? this.options.anthropicThinking ?? maxBudgetTokens,
						maxBudgetTokens,
					),
					1024,
				)
				thinking = { type: "enabled", budget_tokens: budgetTokens }
			}

			return { id: actualId, info, temperature, maxTokens, thinking }
		}

		const id = vertexDefaultModelId
		const info = vertexModels[id]
		const maxTokens = this.options.modelMaxTokens || info.maxTokens || 8192

		return { id, info, temperature, maxTokens, thinking }
	}

	async completePrompt(prompt: string): Promise<string> {
		try {
			let { id, info, temperature, maxTokens, thinking } = this.getModel()
			const useCache = info.supportsPromptCache

			const params = {
				model: id,
				max_tokens: maxTokens,
				temperature,
				thinking,
				system: "", // No system prompt needed for single completions
				messages: [
					{
						role: "user",
						content: useCache
							? [
									{
										type: "text" as const,
										text: prompt,
										cache_control: { type: "ephemeral" },
									},
								]
							: prompt,
					},
				],
				stream: false,
			}

			const response = (await this.client.messages.create(
				params as Anthropic.Messages.MessageCreateParamsNonStreaming,
			)) as unknown as VertexMessageResponse

			const content = response.content[0]
			if (content.type === "text") {
				return content.text
			}
			return ""
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`Vertex completion error: ${error.message}`)
			}
			throw error
		}
	}
}
