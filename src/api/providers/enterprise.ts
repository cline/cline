import { Anthropic } from "@anthropic-ai/sdk"
import { ApiHandler } from "../"
import { ApiHandlerOptions, ModelInfo } from "../../shared/api"
import { ApiStream } from "../transform/stream"
import { withRetry } from "../retry"
import { Stream as AnthropicStream } from "@anthropic-ai/sdk/streaming"
import { RawMessageStreamEvent } from "@anthropic-ai/sdk/resources/messages.mjs"
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk"
import AnthropicBedrock from "@anthropic-ai/bedrock-sdk"

/**
 * Base class for enterprise support
 * This class is abstract and must be extended by a subclass.
 * @abstract
 * @implements ApiHandler
 */
export abstract class EnterpriseHandler<ClientType> implements ApiHandler {
	protected options: ApiHandlerOptions // The options for the enterprise handler.
	protected cache: Map<string, ApiStream> // A cache of message streams.
	protected client!: ClientType // The enterprise client.

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.cache = new Map()
		this._initialize()
	}

	private _initialize() {
		const client = this.getClient()
		if (client instanceof Promise) {
			client
				.then((resolvedClient) => {
					this.client = resolvedClient
				})
				.catch((error) => {
					throw new Error("Failed to initialize client: " + error)
				})
		} else {
			this.client = client
		}
	}

	/**
	 * Creates a message stream to an enterprise model.
	 * @param systemPrompt - The system prompt to initialize the conversation.
	 * @param messages - An array of message parameters.
	 * @returns An asynchronous generator yielding ApiStream events.
	 */
	protected abstract createEnterpriseModelStream(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		modelId: string,
		maxTokens: number,
	): Promise<AnthropicStream<RawMessageStreamEvent>>

	/**
	 * Initializes the enterprise handler.
	 * This method must be implemented by subclasses.
	 */
	protected abstract getClient(): ClientType | Promise<ClientType>

	/**
	 * Creates a message stream.
	 * @param systemPrompt - The system prompt to initialize the conversation.
	 * @param messages - An array of message parameters.
	 * @returns An asynchronous generator yielding ApiStream events.
	 */
	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		// Ensure child implementation is called
		if (this instanceof EnterpriseHandler) {
			const cacheKey = this.generateCacheKey(systemPrompt, messages)
			if (this.cache.has(cacheKey)) {
				yield* this.cache.get(cacheKey)!
				return
			}
			let resultStream = yield* this.createEnterpriseMessage(systemPrompt, messages)
			this.cache.set(cacheKey, resultStream)
		} else {
			throw new Error("Method not implemented. Please use a subclass that implements this method.")
		}
	}

	/**
	 * Creates an enterprise message stream.
	 * This method must be implemented by subclasses.
	 * @param systemPrompt - The system prompt to initialize the conversation.
	 * @param messages - An array of message parameters.
	 * @returns An asynchronous generator yielding ApiStream events.
	 */
	protected abstract createEnterpriseMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream

	/**
	 * Generates a unique cache key based on the system prompt and messages.
	 * @param systemPrompt - The system prompt to initialize the conversation.
	 * @param messages - An array of message parameters.
	 * @returns A string representing the unique cache key.
	 */
	private generateCacheKey(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): string {
		return `${systemPrompt}:${JSON.stringify(messages)}`
	}

	/**
	 * Processes a stream of raw message events.
	 * @param stream - A stream of raw message events.
	 * @returns An asynchronous generator yielding ApiStream events.
	 */
	protected async *processStream(stream: AnthropicStream<RawMessageStreamEvent>): ApiStream {
		for await (const chunk of stream) {
			yield* this.processChunk(chunk)
		}
	}

	protected transformMessage(
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

	/**
	 * Processes a raw message event.
	 * This method must be implemented by subclasses.
	 * @param chunk - A raw message event.
	 * @returns A processed message event.
	 */
	protected abstract processChunk(chunk: RawMessageStreamEvent): any

	abstract getModel(): { id: string; info: ModelInfo }
}
