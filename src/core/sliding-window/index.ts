import { Anthropic } from "@anthropic-ai/sdk"

import { TelemetryService } from "@roo-code/telemetry"

import { ApiHandler } from "../../api"
import { MAX_CONDENSE_THRESHOLD, MIN_CONDENSE_THRESHOLD, summarizeConversation, SummarizeResponse } from "../condense"
import { ApiMessage } from "../task-persistence/apiMessages"

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
 * @param {ApiMessage[]} messages - The conversation messages.
 * @param {number} fracToRemove - The fraction (between 0 and 1) of messages (excluding the first) to remove.
 * @param {string} taskId - The task ID for the conversation, used for telemetry
 * @returns {ApiMessage[]} The truncated conversation messages.
 */
export function truncateConversation(messages: ApiMessage[], fracToRemove: number, taskId: string): ApiMessage[] {
	TelemetryService.instance.captureSlidingWindowTruncation(taskId)
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
 * @param {ApiMessage[]} messages - The conversation messages.
 * @param {number} totalTokens - The total number of tokens in the conversation (excluding the last user message).
 * @param {number} contextWindow - The context window size.
 * @param {number} maxTokens - The maximum number of tokens allowed.
 * @param {ApiHandler} apiHandler - The API handler to use for token counting.
 * @param {boolean} autoCondenseContext - Whether to use LLM summarization or sliding window implementation
 * @param {string} systemPrompt - The system prompt, used for estimating the new context size after summarizing.
 * @returns {ApiMessage[]} The original or truncated conversation messages.
 */

type TruncateOptions = {
	messages: ApiMessage[]
	totalTokens: number
	contextWindow: number
	maxTokens?: number | null
	apiHandler: ApiHandler
	autoCondenseContext: boolean
	autoCondenseContextPercent: number
	systemPrompt: string
	taskId: string
	customCondensingPrompt?: string
	condensingApiHandler?: ApiHandler
	profileThresholds: Record<string, number>
	currentProfileId: string
}

type TruncateResponse = SummarizeResponse & { prevContextTokens: number }

/**
 * Conditionally truncates the conversation messages if the total token count
 * exceeds the model's limit, considering the size of incoming content.
 *
 * @param {TruncateOptions} options - The options for truncation
 * @returns {Promise<ApiMessage[]>} The original or truncated conversation messages.
 */
export async function truncateConversationIfNeeded({
	messages,
	totalTokens,
	contextWindow,
	maxTokens,
	apiHandler,
	autoCondenseContext,
	autoCondenseContextPercent,
	systemPrompt,
	taskId,
	customCondensingPrompt,
	condensingApiHandler,
	profileThresholds,
	currentProfileId,
}: TruncateOptions): Promise<TruncateResponse> {
	let error: string | undefined
	let cost = 0
	// Calculate the maximum tokens reserved for response
	const reservedTokens = maxTokens || contextWindow * 0.2

	// Estimate tokens for the last message (which is always a user message)
	const lastMessage = messages[messages.length - 1]
	const lastMessageContent = lastMessage.content
	const lastMessageTokens = Array.isArray(lastMessageContent)
		? await estimateTokenCount(lastMessageContent, apiHandler)
		: await estimateTokenCount([{ type: "text", text: lastMessageContent as string }], apiHandler)

	// Calculate total effective tokens (totalTokens never includes the last message)
	const prevContextTokens = totalTokens + lastMessageTokens

	// Calculate available tokens for conversation history
	// Truncate if we're within TOKEN_BUFFER_PERCENTAGE of the context window
	const allowedTokens = contextWindow * (1 - TOKEN_BUFFER_PERCENTAGE) - reservedTokens

	// Determine the effective threshold to use
	let effectiveThreshold = autoCondenseContextPercent
	const profileThreshold = profileThresholds[currentProfileId]
	if (profileThreshold !== undefined) {
		if (profileThreshold === -1) {
			// Special case: -1 means inherit from global setting
			effectiveThreshold = autoCondenseContextPercent
		} else if (profileThreshold >= MIN_CONDENSE_THRESHOLD && profileThreshold <= MAX_CONDENSE_THRESHOLD) {
			// Valid custom threshold
			effectiveThreshold = profileThreshold
		} else {
			// Invalid threshold value, fall back to global setting
			console.warn(
				`Invalid profile threshold ${profileThreshold} for profile "${currentProfileId}". Using global default of ${autoCondenseContextPercent}%`,
			)
			effectiveThreshold = autoCondenseContextPercent
		}
	}
	// If no specific threshold is found for the profile, fall back to global setting

	if (autoCondenseContext) {
		const contextPercent = (100 * prevContextTokens) / contextWindow
		if (contextPercent >= effectiveThreshold || prevContextTokens > allowedTokens) {
			// Attempt to intelligently condense the context
			const result = await summarizeConversation(
				messages,
				apiHandler,
				systemPrompt,
				taskId,
				prevContextTokens,
				true, // automatic trigger
				customCondensingPrompt,
				condensingApiHandler,
			)
			if (result.error) {
				error = result.error
				cost = result.cost
			} else {
				return { ...result, prevContextTokens }
			}
		}
	}

	// Fall back to sliding window truncation if needed
	if (prevContextTokens > allowedTokens) {
		const truncatedMessages = truncateConversation(messages, 0.5, taskId)
		return { messages: truncatedMessages, prevContextTokens, summary: "", cost, error }
	}
	// No truncation or condensation needed
	return { messages, summary: "", cost, prevContextTokens, error }
}
