import { normalizeUserInput, stripModeNotices } from "@cline/shared"

/**
 * Canned prompt SdkModeCoordinator sends to drive the plan -> act
 * auto-continuation. Defined here (a leaf module) rather than in the
 * coordinator so display-layer consumers (message-translator, ordinal
 * mapping) don't pull the coordinator's heavy import graph into their tests.
 */
export const ACT_MODE_CONTINUATION_PROMPT = "The user approved switching to act mode. Continue with the approved plan now."

export type SdkUserMessage = {
	role?: unknown
	content?: unknown
	metadata?: unknown
}

export function extractSdkUserText(message: SdkUserMessage): string {
	const { content } = message
	if (typeof content === "string") {
		return content.trim()
	}
	if (!Array.isArray(content)) {
		return ""
	}
	return content
		.map((block) => {
			if (!block || typeof block !== "object") {
				return ""
			}
			const typed = block as { type?: unknown; text?: unknown; content?: unknown }
			if (typed.type === "text" && typeof typed.text === "string") {
				return typed.text.trim()
			}
			if (typed.type === "file" && typeof typed.content === "string") {
				return typed.content.trim()
			}
			return ""
		})
		.filter(Boolean)
		.join("\n")
		.trim()
}

/**
 * Prompts sent to the SDK without a visible user_feedback echo (task
 * resumption, plan -> act auto-continue). They exist in SDK history but not
 * in the visible transcript, so ordinal mapping between the two must skip
 * them or every later user message maps one slot too early.
 */
export function isSyntheticUserPrompt(text: string): boolean {
	// Persisted prompts are wrapped by formatModePrompt as
	// <user_input mode="...">...</user_input>; strip that before matching. A
	// user-initiated plan -> act toggle can additionally prepend a
	// <mode_notice> element to the canned continuation, so strip those too or
	// the synthetic prompt would start counting as a visible user message and
	// shift every later edit/regenerate ordinal by one.
	const normalized = stripModeNotices(normalizeUserInput(text))
	return (
		normalized.startsWith("[TASK RESUMPTION]") ||
		normalized === ACT_MODE_CONTINUATION_PROMPT ||
		// Hook-injected context is model-facing only; the runtime stamps these
		// messages displayRole "system", and this text guard keeps transcripts
		// clean on paths where that metadata is unavailable.
		normalized.startsWith("<hook_context")
	)
}

function hasAttachmentBlocks(message: SdkUserMessage): boolean {
	if (!Array.isArray(message.content)) {
		return false
	}
	let hasAttachment = false
	for (const block of message.content) {
		if (!block || typeof block !== "object") {
			continue
		}
		const type = (block as { type?: unknown }).type
		// Tool results are role "user" in SDK history but are not user input;
		// any media they carry must not make the message count as one.
		if (type === "tool_result" || type === "tool-result") {
			return false
		}
		if (type === "image" || type === "file") {
			hasAttachment = true
		}
	}
	return hasAttachment
}

/**
 * True when the SDK message has no visible user_feedback counterpart. An
 * attachment-only continuation carries the synthetic text alongside the
 * user's image/file blocks AND a visible bubble, so it must still be counted.
 */
export interface PersistedHookContextChip {
	hookName: string
	toolName?: string
	status: "completed"
}

/**
 * Parses hook-context blocks out of a runtime-injected user message so replay
 * can reconstruct the hook status rows shown live. Returns [] for anything
 * that is not a hook-context injection. Forged tags inside hook output are
 * escaped by the runtime (`<\hook_context`), so only real blocks match.
 */
export function extractPersistedHookContextChips(message: SdkUserMessage): PersistedHookContextChip[] {
	if (message.role !== "user") {
		return []
	}
	const text = extractSdkUserText(message)
	if (!text.startsWith("<hook_context")) {
		return []
	}
	const chips: PersistedHookContextChip[] = []
	const blockPattern = /<hook_context source="([^"]+)"(?:\s+tool_name="([^"]*)")?[^>]*>/g
	let match: RegExpExecArray | null = blockPattern.exec(text)
	while (match !== null) {
		chips.push({
			hookName: match[1],
			...(match[2] ? { toolName: match[2] } : {}),
			status: "completed",
		})
		match = blockPattern.exec(text)
	}
	return chips
}

export function isSyntheticSdkUserMessage(message: SdkUserMessage): boolean {
	// Runtime-generated messages (hook context, compaction summaries) carry a
	// display role that marks them model-facing only.
	const metadata = message.metadata as { displayRole?: unknown } | undefined
	const displayRole = typeof metadata?.displayRole === "string" ? metadata.displayRole.trim().toLowerCase() : undefined
	if (displayRole === "system" || displayRole === "status") {
		return true
	}
	const text = extractSdkUserText(message)
	return !!text && isSyntheticUserPrompt(text) && !hasAttachmentBlocks(message)
}

/**
 * Maps the Nth visible user message (1-based ordinal over task/user_feedback
 * rows) to its index in the persisted SDK message history, skipping synthetic
 * prompts that have no visible counterpart.
 */
export function findSdkUserMessageIndexByOrdinal(sdkMessages: SdkUserMessage[], userOrdinal: number): number {
	let seenUsers = 0
	return sdkMessages.findIndex((message) => {
		if (message.role !== "user") {
			return false
		}
		const text = extractSdkUserText(message)
		const hasUserContent = !!text || hasAttachmentBlocks(message)
		if (!hasUserContent || isSyntheticSdkUserMessage(message)) {
			return false
		}
		seenUsers += 1
		return seenUsers === userOrdinal
	})
}

/**
 * Returns the checkpoint run number for a persisted SDK user message.
 * This intentionally mirrors the core checkpoint counter: every root user
 * message starts a run except recovery notices. Hidden mode/resume prompts
 * therefore still advance the counter even though they have no webview row.
 */
export function getSdkCheckpointRunCountForMessageIndex(sdkMessages: SdkUserMessage[], targetIndex: number): number | undefined {
	if (sdkMessages[targetIndex]?.role !== "user") {
		return undefined
	}

	let runCount = 0
	for (let index = 0; index <= targetIndex; index += 1) {
		const message = sdkMessages[index]
		if (message?.role !== "user") {
			continue
		}
		const metadata =
			message.metadata && typeof message.metadata === "object" && !Array.isArray(message.metadata)
				? (message.metadata as Record<string, unknown>)
				: undefined
		if (metadata?.kind !== "recovery_notice") {
			runCount += 1
		}
	}
	return runCount
}
