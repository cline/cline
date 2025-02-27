import { Anthropic } from "@anthropic-ai/sdk"
import { ApiHandler } from "../"
import { ApiHandlerOptions, ModelInfo } from "../../shared/api"
import { ApiStream } from "../transform/stream"
import { withRetry } from "../retry"
import { Stream as AnthropicStream } from "@anthropic-ai/sdk/streaming"
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk"
import AnthropicBedrock from "@anthropic-ai/bedrock-sdk"

/**
 * Abstract base class for Claude-based streaming providers.
 *
 * This class provides a standardized framework for handling Claude-based API interactions,
 * ensuring consistency and reusability. It enforces a contract for subclasses to implement
 * specific methods, promoting a clear and maintainable architecture.
 *
 * The use of generators and yielding allows efficient handling of asynchronous data streams,
 * enabling real-time data processing without blocking the main thread.
 *
 * Generics provide flexibility and type safety for different enterprise clients.
 *
 * Caching improves performance by storing frequently accessed data, reducing latency and load
 * on external services, and optimizing data handling.
 *
 * @template ClientType - The type of client. Must be one of Anthropic, AnthropicVertex, or AnthropicBedrock.
 * @implements ApiHandler
 */

export abstract class ClaudeStreamingHandler<ClientType extends Anthropic | AnthropicVertex | AnthropicBedrock>
	implements ApiHandler
{
	static readonly DEFAULT_TOKEN_SIZE: number = 8192 // The default token size for message generation.
	static readonly DEFAULT_TEMPERATURE: number = 0 // The default temperature for message generation.
	protected options: ApiHandlerOptions // The options for the handler.
	protected cache: Map<string, ApiStream> // A cache of message streams.
	protected client!: ClientType // The client.

	/**
	 * Creates a new handler.
	 * @param options - The options for the handler.
	 */
	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.cache = new Map()
		this._initialize()
	}

	/**
	 * Initializes the client.
	 */
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
	 * Creates a message stream to a Claude model.
	 * @param systemPrompt - The system prompt to initialize the conversation.
	 * @param messages - An array of message parameters.
	 * @returns An asynchronous generator yielding ApiStream events.
	 */
	protected abstract createModelStream(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		modelId: string,
		maxTokens: number,
	): Promise<AnthropicStream<Anthropic.Messages.RawMessageStreamEvent>>

	/**
	 * Initializes the client.
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
		try {
			yield* this.createStreamingMessage(systemPrompt, messages)
		} catch (error) {
			this.handleMessageStreamError(error)
		}
	}

	/**
	 * Handles an error that occurs during message stream creation.  Override to handle provider-specific errors.
	 * @param error - The error that threw during message stream creation.
	 * @throws An error with a message indicating the failure.
	 */
	protected handleMessageStreamError(error: any) {
		throw new Error(`Failed to create message stream: ${error instanceof Error ? error.message : "Unknown error"}`)
	}

	/**
	 * Creates a streaming message stream.
	 * This method must be implemented by subclasses.
	 * @param systemPrompt - The system prompt to initialize the conversation.
	 * @param messages - An array of message parameters.
	 * @returns An asynchronous generator yielding ApiStream events.
	 */
	protected abstract createStreamingMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream

	/**
	 * Processes a stream of raw message events.
	 * @param stream - A stream of raw message events.
	 * @returns An asynchronous generator yielding ApiStream events.
	 */
	protected async *processStream(stream: AnthropicStream<Anthropic.Messages.RawMessageStreamEvent>): ApiStream {
		for await (const chunk of stream) {
			yield* this.processChunk(chunk)
		}
	}

	/**
	 * Processes each chunk of the stream and yields the appropriate ApiStream events.
	 * @param chunk - The chunk of data received from the stream.
	 * @returns An asynchronous generator yielding ApiStream events.
	 */
	protected async *processChunk(chunk: any): ApiStream {
		switch (chunk.type) {
			case "message_start":
				// tells us cache reads/writes/input/output
				yield {
					type: "usage",
					inputTokens: chunk.message.usage.input_tokens || 0,
					outputTokens: chunk.message.usage.output_tokens || 0,
					cacheWriteTokens: chunk.message.usage.cache_creation_input_tokens || undefined,
					cacheReadTokens: chunk.message.usage.cache_read_input_tokens || undefined,
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
				if (chunk.content_block.type === "text") {
					// we may receive multiple text blocks, in which case just insert a line break between them
					if (chunk.index > 0) {
						yield { type: "text", text: "\n" }
					}
					yield { type: "text", text: chunk.content_block.text }
				}
				break
			case "content_block_delta":
				if (chunk.delta.type === "text_delta") {
					yield { type: "text", text: chunk.delta.text }
				}
				break
		}
	}

	/**
	 * Transforms a message based on its index and user message indices.
	 * @param message - The message to transform.
	 * @param index - The index of the message in the array.
	 * @param lastUserMsgIndex - The index of the last user message.
	 * @param secondLastMsgUserIndex - The index of the second last user message.
	 * @returns The transformed message.
	 */
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
	 * Gets the model ID and info for the handler.
	 * This method must be implemented by subclasses.
	 * @returns The model ID and info.
	 */
	abstract getModel(): { id: string; info: ModelInfo }
}
