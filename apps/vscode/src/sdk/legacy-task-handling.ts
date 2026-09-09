import { type ContentBlock, formatDisplayUserInput, type MessageWithMetadata } from "@cline/shared"
import type { ClineMessage } from "@shared/ExtensionMessage"
import type { HistoryItem } from "@shared/HistoryItem"
import { sanitizeInitialMessagesForSessionStart } from "./initial-message-sanitizer"

export const LEGACY_RESUME_MODEL_WARNING =
	"Warning: this is a legacy conversation, which means tool names may have changed. Please use the most up-to-date tools you are aware of."

function anthropicContentBlockToSdkBlock(block: unknown): ContentBlock | undefined {
	if (!block || typeof block !== "object") {
		return undefined
	}
	const record = block as Record<string, unknown>
	switch (record.type) {
		case "text":
			return typeof record.text === "string" ? { type: "text", text: record.text } : undefined
		case "tool_use":
			return typeof record.id === "string" && typeof record.name === "string"
				? {
						type: "tool_use",
						id: record.id,
						name: record.name,
						input: (record.input as Record<string, unknown>) ?? {},
					}
				: undefined
		case "tool_result":
			return typeof record.tool_use_id === "string"
				? {
						type: "tool_result",
						tool_use_id: record.tool_use_id,
						name: typeof record.name === "string" ? record.name : "",
						content: typeof record.content === "string" ? record.content : JSON.stringify(record.content ?? ""),
						is_error: typeof record.is_error === "boolean" ? record.is_error : undefined,
					}
				: undefined
		case "thinking":
			return typeof record.thinking === "string" ? { type: "thinking", thinking: record.thinking } : undefined
		case "image": {
			const source = record.source as Record<string, unknown> | undefined
			return source?.type === "base64" && typeof source.data === "string" && typeof source.media_type === "string"
				? { type: "image", data: source.data, mediaType: source.media_type }
				: undefined
		}
		default:
			return undefined
	}
}

function messageContainsLegacyResumeWarning(message: unknown): boolean {
	if (!message || typeof message !== "object") {
		return false
	}
	const content = (message as { content?: unknown }).content
	if (typeof content === "string") {
		return content.includes(LEGACY_RESUME_MODEL_WARNING)
	}
	if (Array.isArray(content)) {
		return content.some(
			(block) =>
				block &&
				typeof block === "object" &&
				typeof (block as { text?: unknown }).text === "string" &&
				(block as { text: string }).text.includes(LEGACY_RESUME_MODEL_WARNING),
		)
	}
	return false
}

export function appendLegacyResumeWarning<T extends { role: string; content: unknown }>(messages: T[]): T[] {
	if (messages.some(messageContainsLegacyResumeWarning)) {
		return messages
	}
	return [
		...messages,
		{
			role: "user",
			content: LEGACY_RESUME_MODEL_WARNING,
		} as T,
	]
}

/**
 * Classic Cline truncated long conversations by omitting an index range of
 * api_conversation_history from every API request: it kept the first
 * user-assistant pair, dropped everything up to and including the range end,
 * and stripped orphaned tool_results from the first kept message
 * (ContextManager.getTruncatedMessages — see origin/main). The range was
 * persisted on the history item while the full history stayed on disk.
 *
 * Migration must replay that truncation: converting the full file hands the
 * resumed SDK session an untruncated working context that can exceed the
 * model's context window by millions of tokens, wedging the session with
 * "prompt is too long" on every request (cline/cline#12996).
 */
function applyLegacyDeletedRange(apiHistory: unknown[], historyItem: HistoryItem): unknown[] {
	const deletedRangeEnd = historyItem.conversationHistoryDeletedRange?.[1]
	if (
		deletedRangeEnd === undefined ||
		!Number.isInteger(deletedRangeEnd) ||
		deletedRangeEnd < 2 ||
		deletedRangeEnd >= apiHistory.length - 1
	) {
		return apiHistory
	}
	const truncated = [...apiHistory.slice(0, 2), ...apiHistory.slice(deletedRangeEnd + 1)]
	// Classic's orphan cleanup: the first message after the cut may carry
	// tool_results whose tool_use was truncated away, which providers reject.
	const firstAfterCut = truncated[2]
	if (firstAfterCut && typeof firstAfterCut === "object") {
		const record = firstAfterCut as Record<string, unknown>
		if (record.role === "user" && Array.isArray(record.content)) {
			const content = record.content.filter(
				(block) => !(block && typeof block === "object" && (block as { type?: unknown }).type === "tool_result"),
			)
			if (content.length !== record.content.length) {
				truncated[2] = { ...record, content }
			}
		}
	}
	return truncated
}

export function legacyApiHistoryToSdkMessages(apiHistory: unknown[], historyItem: HistoryItem): MessageWithMetadata[] {
	const messages = applyLegacyDeletedRange(apiHistory, historyItem).flatMap((raw): MessageWithMetadata[] => {
		if (!raw || typeof raw !== "object") {
			return []
		}
		const record = raw as Record<string, unknown>
		const role = record.role === "assistant" ? "assistant" : record.role === "user" ? "user" : undefined
		if (!role) {
			return []
		}

		if (typeof record.content === "string") {
			return [
				{
					role,
					content: role === "user" ? formatDisplayUserInput(record.content) : record.content,
				},
			]
		}

		if (Array.isArray(record.content)) {
			const content = record.content.flatMap((block) => {
				const converted = anthropicContentBlockToSdkBlock(block)
				if (role === "user" && converted?.type === "text") {
					return [{ ...converted, text: formatDisplayUserInput(converted.text) }]
				}
				return converted ? [converted] : []
			})
			return content.length > 0 ? [{ role, content }] : []
		}

		return []
	})

	const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant")
	if (lastAssistant && !lastAssistant.metrics) {
		lastAssistant.metrics = {
			inputTokens: (historyItem.tokensIn ?? 0) + (historyItem.cacheReads ?? 0) + (historyItem.cacheWrites ?? 0),
			outputTokens: historyItem.tokensOut ?? 0,
			cacheReadTokens: historyItem.cacheReads ?? 0,
			cacheWriteTokens: historyItem.cacheWrites ?? 0,
			cost: historyItem.totalCost ?? 0,
		}
		lastAssistant.modelInfo = historyItem.modelId ? { id: historyItem.modelId, provider: "unknown" } : lastAssistant.modelInfo
	}

	return sanitizeInitialMessagesForSessionStart(appendLegacyResumeWarning(messages)) as MessageWithMetadata[]
}

export function mergeLegacyUiMessagesWithResumedSdkMessages(
	legacyUiMessages: ClineMessage[],
	sdkClineMessages: ClineMessage[],
): ClineMessage[] {
	const warningIndex = sdkClineMessages.findIndex((message) => message.text?.includes(LEGACY_RESUME_MODEL_WARNING))
	if (warningIndex === -1) {
		return sdkClineMessages
	}

	const resumedMessages = sdkClineMessages.slice(warningIndex + 1)
	return [...legacyUiMessages, ...resumedMessages]
}
