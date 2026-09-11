import { formatDisplayUserInput } from "@cline/shared";

export type MessageDisplayRole =
	| "user"
	| "assistant"
	| "tool"
	| "system"
	| "status"
	| "error";

type MessageLike = {
	role?: unknown;
	content?: unknown;
	metadata?: unknown;
};

const SYNTHETIC_USER_MESSAGE_KINDS = new Set([
	"auto_compaction",
	"compaction_budget_emergency",
	"completion_reminder",
	"loop_detection_notice",
	"manual_compaction",
	"mistake_stop_notice",
	"recovery_notice",
]);

function normalizeMessageRole(role: unknown): MessageDisplayRole {
	switch (role) {
		case "user":
		case "assistant":
		case "tool":
		case "system":
		case "status":
		case "error":
			return role;
		default:
			return "assistant";
	}
}

function readMessageMetadata(
	message: MessageLike,
): Record<string, unknown> | undefined {
	return message.metadata &&
		typeof message.metadata === "object" &&
		!Array.isArray(message.metadata)
		? (message.metadata as Record<string, unknown>)
		: undefined;
}

function readStoredUserRunSpan(
	metadata: Record<string, unknown> | undefined,
): number | undefined {
	const span = metadata?.userRunSpan;
	return typeof span === "number" && Number.isInteger(span) && span >= 0
		? span
		: undefined;
}

function readVisibleUserContent(message: MessageLike): {
	hasAttachment: boolean;
	text: string;
} {
	if (typeof message.content === "string") {
		return { hasAttachment: false, text: message.content };
	}
	if (!Array.isArray(message.content)) {
		// Some history consumers only project role and metadata. Preserve the
		// established role-based behavior when content is unavailable.
		return { hasAttachment: false, text: "unknown" };
	}
	let hasAttachment = false;
	let hasToolResult = false;
	const text: string[] = [];
	for (const item of message.content) {
		if (!item || typeof item !== "object" || Array.isArray(item)) {
			continue;
		}
		const block = item as Record<string, unknown>;
		if (block.type === "text" && typeof block.text === "string") {
			text.push(block.text);
		} else if (block.type === "tool_result" || block.type === "tool-result") {
			hasToolResult = true;
		} else if (block.type === "file" || block.type === "image") {
			hasAttachment = true;
		}
	}
	return {
		// Tool-result messages can contain media, but that media belongs to the
		// tool output rather than a visible user prompt.
		hasAttachment: hasAttachment && !hasToolResult,
		text: text.join("\n"),
	};
}

function isSyntheticContinuationPrompt(text: string): boolean {
	const normalized = formatDisplayUserInput(text);
	return (
		normalized.startsWith("[TASK RESUMPTION]") ||
		normalized ===
			"The user approved switching to act mode. Continue with the approved plan now."
	);
}

/** Resolves the role a persisted message should use when presented to a user. */
export function resolveMessageDisplayRole(
	message: MessageLike,
): MessageDisplayRole {
	const role = normalizeMessageRole(message.role);
	const metadata = readMessageMetadata(message);
	const displayRole =
		typeof metadata?.displayRole === "string"
			? metadata.displayRole.trim().toLowerCase()
			: "";
	if (
		displayRole === "system" ||
		displayRole === "status" ||
		displayRole === "error"
	) {
		return displayRole;
	}
	return role;
}

/**
 * Returns how many absolute root runs a persisted message represents.
 *
 * Compaction can fold several earlier user turns into one synthetic message.
 * Its persisted span keeps later visible prompts aligned with checkpoint
 * history. Tool results and system-injected user-role messages contribute no
 * runs.
 */
export function getUserRunSpan(message: MessageLike): number {
	if (normalizeMessageRole(message.role) !== "user") {
		return 0;
	}
	const metadata = readMessageMetadata(message);
	const kind = typeof metadata?.kind === "string" ? metadata.kind : undefined;
	const storedSpan = readStoredUserRunSpan(metadata);
	if (kind === "compaction" || kind === "compaction_summary") {
		return storedSpan ?? 1;
	}
	if (storedSpan !== undefined) {
		return storedSpan;
	}
	if (kind && SYNTHETIC_USER_MESSAGE_KINDS.has(kind)) {
		return 0;
	}
	const content = readVisibleUserContent(message);
	if (!content.hasAttachment && !formatDisplayUserInput(content.text)) {
		return 0;
	}
	if (!content.hasAttachment && isSyntheticContinuationPrompt(content.text)) {
		return 0;
	}
	return 1;
}

export function isUserRunMessage(message: MessageLike): boolean {
	return getUserRunSpan(message) > 0;
}

export function countUserRunMessages(
	messages: readonly MessageLike[] | undefined,
): number {
	let count = 0;
	for (const message of messages ?? []) {
		count += getUserRunSpan(message);
	}
	return count;
}
