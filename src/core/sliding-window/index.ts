import { Anthropic } from "@anthropic-ai/sdk"
import { ApiHandler } from "../../api"

/**
 * Default percentage of the context window to use as a buffer when deciding when to truncate
 */
export const TOKEN_BUFFER_PERCENTAGE = 0.1

/**
 * Counts tokens for user content using the provider's token counting implementation.
 *
 * @param {Array<Anthropic.Messages.ContentBlockParam>} content - The content to count tokens for
 * @param {ApiHandler} apiHandler - The API handler to use for token counting
 * @returns {Promise<number>} A promise resolving to the token count
 */
export async function estimateTokenCount(
	content: Array<Anthropic.Messages.ContentBlockParam>,
	apiHandler: ApiHandler,
): Promise<number> {
	if (!content || content.length === 0) return 0
	return apiHandler.countTokens(content)
}

/**
 * Truncates a conversation by removing a fraction of the messages.
 *
 * The first message is always retained, and a specified fraction (rounded to an even number)
 * of messages from the beginning (excluding the first) is removed.
 *
 * @param {Anthropic.Messages.MessageParam[]} messages - The conversation messages.
 * @param {number} fracToRemove - The fraction (between 0 and 1) of messages (excluding the first) to remove.
 * @returns {Anthropic.Messages.MessageParam[]} The truncated conversation messages.
 */
export function truncateConversation(
	messages: Anthropic.Messages.MessageParam[],
	fracToRemove: number,
): Anthropic.Messages.MessageParam[] {
	const truncatedMessages = [messages[0]]
	const rawMessagesToRemove = Math.floor((messages.length - 1) * fracToRemove)
	const messagesToRemove = rawMessagesToRemove - (rawMessagesToRemove % 2)
	const remainingMessages = messages.slice(messagesToRemove + 1)
	truncatedMessages.push(...remainingMessages)

	return truncatedMessages
}

/**
 * Conditionally truncates the conversation messages if the total token count
 * exceeds the model's limit, considering the size of incoming content.
 *
 * @param {Anthropic.Messages.MessageParam[]} messages - The conversation messages.
 * @param {number} totalTokens - The total number of tokens in the conversation (excluding the last user message).
 * @param {number} contextWindow - The context window size.
 * @param {number} maxTokens - The maximum number of tokens allowed.
 * @param {ApiHandler} apiHandler - The API handler to use for token counting.
 * @returns {Anthropic.Messages.MessageParam[]} The original or truncated conversation messages.
 */

type TruncateOptions = {
	messages: Anthropic.Messages.MessageParam[]
	totalTokens: number
	contextWindow: number
	maxTokens?: number | null
	apiHandler: ApiHandler
}

/**
 * Conditionally truncates the conversation messages if the total token count
 * exceeds the model's limit, considering the size of incoming content.
 *
 * @param {TruncateOptions} options - The options for truncation
 * @returns {Promise<Anthropic.Messages.MessageParam[]>} The original or truncated conversation messages.
 */
export async function truncateConversationIfNeeded({
	messages,
	totalTokens,
	contextWindow,
	maxTokens,
	apiHandler,
}: TruncateOptions): Promise<Anthropic.Messages.MessageParam[]> {
	// Calculate the maximum tokens reserved for response
	const reservedTokens = maxTokens || contextWindow * 0.2

	// Estimate tokens for the last message (which is always a user message)
	const lastMessage = messages[messages.length - 1]
	const lastMessageContent = lastMessage.content
	const lastMessageTokens = Array.isArray(lastMessageContent)
		? await estimateTokenCount(lastMessageContent, apiHandler)
		: await estimateTokenCount([{ type: "text", text: lastMessageContent as string }], apiHandler)

	// Calculate total effective tokens (totalTokens never includes the last message)
	const effectiveTokens = totalTokens + lastMessageTokens

	// Calculate available tokens for conversation history
	// Truncate if we're within TOKEN_BUFFER_PERCENTAGE of the context window
	const allowedTokens = contextWindow * (1 - TOKEN_BUFFER_PERCENTAGE) - reservedTokens

	// Determine if truncation is needed and apply if necessary
	return effectiveTokens > allowedTokens ? truncateConversation(messages, 0.5) : messages
}
