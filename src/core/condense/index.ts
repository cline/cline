import Anthropic from "@anthropic-ai/sdk"

import { TelemetryService } from "@roo-code/telemetry"

import { t } from "../../i18n"
import { ApiHandler } from "../../api"
import { ApiMessage } from "../task-persistence/apiMessages"
import { maybeRemoveImageBlocks } from "../../api/transform/image-cleaning"

export const N_MESSAGES_TO_KEEP = 3
export const MIN_CONDENSE_THRESHOLD = 5 // Minimum percentage of context window to trigger condensing
export const MAX_CONDENSE_THRESHOLD = 100 // Maximum percentage of context window to trigger condensing

const SUMMARY_PROMPT = `\
Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions.
This summary should be thorough in capturing technical details, code patterns, and architectural decisions that would be essential for continuing with the conversation and supporting any continuing tasks.

Your summary should be structured as follows:
Context: The context to continue the conversation with. If applicable based on the current task, this should include:
  1. Previous Conversation: High level details about what was discussed throughout the entire conversation with the user. This should be written to allow someone to be able to follow the general overarching conversation flow.
  2. Current Work: Describe in detail what was being worked on prior to this request to summarize the conversation. Pay special attention to the more recent messages in the conversation.
  3. Key Technical Concepts: List all important technical concepts, technologies, coding conventions, and frameworks discussed, which might be relevant for continuing with this work.
  4. Relevant Files and Code: If applicable, enumerate specific files and code sections examined, modified, or created for the task continuation. Pay special attention to the most recent messages and changes.
  5. Problem Solving: Document problems solved thus far and any ongoing troubleshooting efforts.
  6. Pending Tasks and Next Steps: Outline all pending tasks that you have explicitly been asked to work on, as well as list the next steps you will take for all outstanding work, if applicable. Include code snippets where they add clarity. For any next steps, include direct quotes from the most recent conversation showing exactly what task you were working on and where you left off. This should be verbatim to ensure there's no information loss in context between tasks.

Example summary structure:
1. Previous Conversation:
  [Detailed description]
2. Current Work:
  [Detailed description]
3. Key Technical Concepts:
  - [Concept 1]
  - [Concept 2]
  - [...]
4. Relevant Files and Code:
  - [File Name 1]
    - [Summary of why this file is important]
    - [Summary of the changes made to this file, if any]
    - [Important Code Snippet]
  - [File Name 2]
    - [Important Code Snippet]
  - [...]
5. Problem Solving:
  [Detailed description]
6. Pending Tasks and Next Steps:
  - [Task 1 details & next steps]
  - [Task 2 details & next steps]
  - [...]

Output only the summary of the conversation so far, without any additional commentary or explanation.
`

export type SummarizeResponse = {
	messages: ApiMessage[] // The messages after summarization
	summary: string // The summary text; empty string for no summary
	cost: number // The cost of the summarization operation
	newContextTokens?: number // The number of tokens in the context for the next API request
	error?: string // Populated iff the operation fails: error message shown to the user on failure (see Task.ts)
}

/**
 * Summarizes the conversation messages using an LLM call
 *
 * @param {ApiMessage[]} messages - The conversation messages
 * @param {ApiHandler} apiHandler - The API handler to use for token counting.
 * @param {string} systemPrompt - The system prompt for API requests, which should be considered in the context token count
 * @param {string} taskId - The task ID for the conversation, used for telemetry
 * @param {boolean} isAutomaticTrigger - Whether the summarization is triggered automatically
 * @returns {SummarizeResponse} - The result of the summarization operation (see above)
 */
/**
 * Summarizes the conversation messages using an LLM call
 *
 * @param {ApiMessage[]} messages - The conversation messages
 * @param {ApiHandler} apiHandler - The API handler to use for token counting (fallback if condensingApiHandler not provided)
 * @param {string} systemPrompt - The system prompt for API requests (fallback if customCondensingPrompt not provided)
 * @param {string} taskId - The task ID for the conversation, used for telemetry
 * @param {number} prevContextTokens - The number of tokens currently in the context, used to ensure we don't grow the context
 * @param {boolean} isAutomaticTrigger - Whether the summarization is triggered automatically
 * @param {string} customCondensingPrompt - Optional custom prompt to use for condensing
 * @param {ApiHandler} condensingApiHandler - Optional specific API handler to use for condensing
 * @returns {SummarizeResponse} - The result of the summarization operation (see above)
 */
export async function summarizeConversation(
	messages: ApiMessage[],
	apiHandler: ApiHandler,
	systemPrompt: string,
	taskId: string,
	prevContextTokens: number,
	isAutomaticTrigger?: boolean,
	customCondensingPrompt?: string,
	condensingApiHandler?: ApiHandler,
): Promise<SummarizeResponse> {
	TelemetryService.instance.captureContextCondensed(
		taskId,
		isAutomaticTrigger ?? false,
		!!customCondensingPrompt?.trim(),
		!!condensingApiHandler,
	)

	const response: SummarizeResponse = { messages, cost: 0, summary: "" }
	const messagesToSummarize = getMessagesSinceLastSummary(messages.slice(0, -N_MESSAGES_TO_KEEP))

	if (messagesToSummarize.length <= 1) {
		const error =
			messages.length <= N_MESSAGES_TO_KEEP + 1
				? t("common:errors.condense_not_enough_messages")
				: t("common:errors.condensed_recently")
		return { ...response, error }
	}

	const keepMessages = messages.slice(-N_MESSAGES_TO_KEEP)
	// Check if there's a recent summary in the messages we're keeping
	const recentSummaryExists = keepMessages.some((message) => message.isSummary)

	if (recentSummaryExists) {
		const error = t("common:errors.condensed_recently")
		return { ...response, error }
	}

	const finalRequestMessage: Anthropic.MessageParam = {
		role: "user",
		content: "Summarize the conversation so far, as described in the prompt instructions.",
	}

	const requestMessages = maybeRemoveImageBlocks([...messagesToSummarize, finalRequestMessage], apiHandler).map(
		({ role, content }) => ({ role, content }),
	)

	// Note: this doesn't need to be a stream, consider using something like apiHandler.completePrompt
	// Use custom prompt if provided and non-empty, otherwise use the default SUMMARY_PROMPT
	const promptToUse = customCondensingPrompt?.trim() ? customCondensingPrompt.trim() : SUMMARY_PROMPT

	// Use condensing API handler if provided, otherwise use main API handler
	let handlerToUse = condensingApiHandler || apiHandler

	// Check if the chosen handler supports the required functionality
	if (!handlerToUse || typeof handlerToUse.createMessage !== "function") {
		console.warn(
			"Chosen API handler for condensing does not support message creation or is invalid, falling back to main apiHandler.",
		)

		handlerToUse = apiHandler // Fallback to the main, presumably valid, apiHandler

		// Ensure the main apiHandler itself is valid before this point or add another check.
		if (!handlerToUse || typeof handlerToUse.createMessage !== "function") {
			// This case should ideally not happen if main apiHandler is always valid.
			// Consider throwing an error or returning a specific error response.
			console.error("Main API handler is also invalid for condensing. Cannot proceed.")
			// Return an appropriate error structure for SummarizeResponse
			const error = t("common:errors.condense_handler_invalid")
			return { ...response, error }
		}
	}

	const stream = handlerToUse.createMessage(promptToUse, requestMessages)

	let summary = ""
	let cost = 0
	let outputTokens = 0

	for await (const chunk of stream) {
		if (chunk.type === "text") {
			summary += chunk.text
		} else if (chunk.type === "usage") {
			// Record final usage chunk only
			cost = chunk.totalCost ?? 0
			outputTokens = chunk.outputTokens ?? 0
		}
	}

	summary = summary.trim()

	if (summary.length === 0) {
		const error = t("common:errors.condense_failed")
		return { ...response, cost, error }
	}

	const summaryMessage: ApiMessage = {
		role: "assistant",
		content: summary,
		ts: keepMessages[0].ts,
		isSummary: true,
	}

	const newMessages = [...messages.slice(0, -N_MESSAGES_TO_KEEP), summaryMessage, ...keepMessages]

	// Count the tokens in the context for the next API request
	// We only estimate the tokens in summaryMesage if outputTokens is 0, otherwise we use outputTokens
	const systemPromptMessage: ApiMessage = { role: "user", content: systemPrompt }

	const contextMessages = outputTokens
		? [systemPromptMessage, ...keepMessages]
		: [systemPromptMessage, summaryMessage, ...keepMessages]

	const contextBlocks = contextMessages.flatMap((message) =>
		typeof message.content === "string" ? [{ text: message.content, type: "text" as const }] : message.content,
	)

	const newContextTokens = outputTokens + (await apiHandler.countTokens(contextBlocks))
	if (newContextTokens >= prevContextTokens) {
		const error = t("common:errors.condense_context_grew")
		return { ...response, cost, error }
	}
	return { messages: newMessages, summary, cost, newContextTokens }
}

/* Returns the list of all messages since the last summary message, including the summary. Returns all messages if there is no summary. */
export function getMessagesSinceLastSummary(messages: ApiMessage[]): ApiMessage[] {
	let lastSummaryIndexReverse = [...messages].reverse().findIndex((message) => message.isSummary)

	if (lastSummaryIndexReverse === -1) {
		return messages
	}

	const lastSummaryIndex = messages.length - lastSummaryIndexReverse - 1
	const messagesSinceSummary = messages.slice(lastSummaryIndex)

	// Bedrock requires the first message to be a user message.
	// See https://github.com/RooCodeInc/Roo-Code/issues/4147
	const userMessage: ApiMessage = {
		role: "user",
		content: "Please continue from the following summary:",
		ts: messages[0]?.ts ? messages[0].ts - 1 : Date.now(),
	}
	return [userMessage, ...messagesSinceSummary]
}
