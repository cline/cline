import type { MessageWithMetadata } from "../llms/messages";

/** Transcript slice `[start, end)` covered by one iteration. */
export interface SessionMessageIterationGroup {
	start: number;
	end: number;
	/** Index of the assistant message that is the iteration's model call. */
	assistantIndex?: number;
}

const NON_CONVERSATIONAL_DISPLAY_ROLES = new Set(["system", "status", "error"]);

function displayRole(message: MessageWithMetadata): string | undefined {
	const role = message.metadata?.displayRole;
	return typeof role === "string" ? role.trim().toLowerCase() : undefined;
}

/** An assistant message produced by a model call (not a display-only notice). */
export function isSessionModelCallMessage(
	message: MessageWithMetadata,
): boolean {
	if (message.role !== "assistant") {
		return false;
	}
	if (message.metadata?.displayOnly === true) {
		return false;
	}
	const role = displayRole(message);
	return !role || !NON_CONVERSATIONAL_DISPLAY_ROLES.has(role);
}

export function hasSessionToolResult(message: MessageWithMetadata): boolean {
	return (
		Array.isArray(message.content) &&
		message.content.some((block) => block.type === "tool_result")
	);
}

/**
 * Splits a persisted transcript into iterations: each model call plus the
 * tool results and notices that follow it, preceded by the user-role
 * messages that led to it. Position `i` is iteration `i + 1`, the numbering
 * used by `MessageWithMetadata.iteration` and by session replay bundles
 * (`sessions[].iterations[].index`).
 */
export function groupSessionMessageIterations(
	messages: readonly MessageWithMetadata[],
): SessionMessageIterationGroup[] {
	const groups: SessionMessageIterationGroup[] = [];
	let current: SessionMessageIterationGroup | undefined;
	for (const [index, message] of messages.entries()) {
		if (isSessionModelCallMessage(message)) {
			if (!current || current.assistantIndex !== undefined) {
				if (current) {
					groups.push(current);
				}
				current = { start: index, end: index + 1 };
			}
			current.assistantIndex = index;
			current.end = index + 1;
			continue;
		}
		const followsModelCall = current?.assistantIndex !== undefined;
		const attachesToCurrent =
			followsModelCall &&
			(hasSessionToolResult(message) || message.role === "assistant");
		if (current && (attachesToCurrent || !followsModelCall)) {
			current.end = index + 1;
			continue;
		}
		if (current) {
			groups.push(current);
		}
		current = { start: index, end: index + 1 };
	}
	if (current) {
		groups.push(current);
	}
	return groups;
}
