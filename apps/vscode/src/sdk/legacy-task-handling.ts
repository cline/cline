import { type ContentBlock, formatDisplayUserInput, type MessageWithMetadata } from "@cline/shared"
import type { ClineMessage } from "@shared/ExtensionMessage"
import type { HistoryItem } from "@shared/HistoryItem"
import { sanitizeInitialMessagesForSessionStart } from "./initial-message-sanitizer"

const LEGACY_RESUME_WARNING_MARKER = "[cline-legacy-resume-warning:v1]"
const HISTORICAL_LEGACY_RESUME_MODEL_WARNING =
	"Warning: this is a legacy conversation, which means tool names may have changed. Please use the most up-to-date tools you are aware of."
export const LEGACY_RESUME_MODEL_WARNING = `${LEGACY_RESUME_WARNING_MARKER}
Warning: this conversation was created by an older Cline runtime. Tool names, configuration paths, file formats, and product instructions in the earlier conversation may be obsolete. Do not rely on earlier configuration guidance or remembered file locations. Use the tools and host-provided configuration locations available in the current session, and verify current product behavior before diagnosing a migration or configuration problem.`

function isLegacyResumeWarningText(text: string): boolean {
	return text.includes(LEGACY_RESUME_WARNING_MARKER) || text.includes(HISTORICAL_LEGACY_RESUME_MODEL_WARNING)
}

function removeLegacyResumeWarningText(text: string): string {
	return text.replace(LEGACY_RESUME_MODEL_WARNING, "").replace(HISTORICAL_LEGACY_RESUME_MODEL_WARNING, "").trim()
}

function upgradeLegacyResumeWarning<T extends { role: string; content: unknown }>(message: T): T {
	const replaceHistoricalWarning = (text: string): string =>
		text.includes(LEGACY_RESUME_WARNING_MARKER)
			? text
			: text.replace(HISTORICAL_LEGACY_RESUME_MODEL_WARNING, LEGACY_RESUME_MODEL_WARNING)
	if (typeof message.content === "string") {
		return {
			...message,
			content: replaceHistoricalWarning(message.content),
		}
	}
	if (Array.isArray(message.content)) {
		return {
			...message,
			content: message.content.map((block) =>
				block && typeof block === "object" && typeof (block as { text?: unknown }).text === "string"
					? {
							...block,
							text: replaceHistoricalWarning((block as { text: string }).text),
						}
					: block,
			),
		}
	}
	return message
}

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
		return isLegacyResumeWarningText(content)
	}
	if (Array.isArray(content)) {
		return content.some(
			(block) =>
				block &&
				typeof block === "object" &&
				typeof (block as { text?: unknown }).text === "string" &&
				isLegacyResumeWarningText((block as { text: string }).text),
		)
	}
	return false
}

export function appendLegacyResumeWarning<T extends { role: string; content: unknown }>(messages: T[]): T[] {
	const upgradedMessages = messages.map(upgradeLegacyResumeWarning)
	if (upgradedMessages.some(messageContainsLegacyResumeWarning)) {
		return upgradedMessages
	}
	return [
		...upgradedMessages,
		{
			role: "user",
			content: LEGACY_RESUME_MODEL_WARNING,
		} as T,
	]
}

export function legacyApiHistoryToSdkMessages(apiHistory: unknown[], historyItem: HistoryItem): MessageWithMetadata[] {
	const messages = apiHistory.flatMap((raw): MessageWithMetadata[] => {
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
	const warningIndex = sdkClineMessages.findIndex(
		(message) => typeof message.text === "string" && isLegacyResumeWarningText(message.text),
	)
	if (warningIndex === -1) {
		return sdkClineMessages
	}

	const warningMessage = sdkClineMessages[warningIndex]
	const remainingWarningMessageText = warningMessage?.text ? removeLegacyResumeWarningText(warningMessage.text) : ""
	const resumedMessages = [
		...(warningMessage && remainingWarningMessageText ? [{ ...warningMessage, text: remainingWarningMessageText }] : []),
		...sdkClineMessages.slice(warningIndex + 1),
	]
	return [...legacyUiMessages, ...resumedMessages]
}
