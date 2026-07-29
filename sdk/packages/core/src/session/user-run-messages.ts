export type MessageDisplayRole =
	| "user"
	| "assistant"
	| "tool"
	| "system"
	| "status"
	| "error";

type MessageLike = {
	role?: unknown;
	metadata?: unknown;
};

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
 * Returns whether a persisted message advances the root run counter.
 *
 * Display role is intentionally irrelevant here. Compaction can present an
 * earlier user run as a system message, but that run still occupies its
 * original absolute position in checkpoint history.
 */
export function isUserRunMessage(message: MessageLike): boolean {
	if (normalizeMessageRole(message.role) !== "user") {
		return false;
	}
	return readMessageMetadata(message)?.kind !== "recovery_notice";
}

export function countUserRunMessages(
	messages: readonly MessageLike[] | undefined,
): number {
	let count = 0;
	for (const message of messages ?? []) {
		if (isUserRunMessage(message)) {
			count += 1;
		}
	}
	return count;
}
