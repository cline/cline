// This file provides a single, shared definition of "a genuine user turn"
// for the persisted conversation format (`LlmsProviders.Message`), reused by
// both checkpoint creation (via checkpoint-run-counting.ts) and checkpoint
// restore so the two can never drift from each other again.
import type * as LlmsProviders from "@cline/llms";

/**
 * Metadata `kind` tags that mark a `role: "user"` message as a synthetic,
 * system-injected notice rather than something the user actually typed.
 * Keep this in sync with every `metadata: { kind: "..." }` tag applied to a
 * `role: "user"` message across the codebase.
 */
const SYNTHETIC_USER_MESSAGE_KINDS = new Set([
	"recovery_notice",
	"compaction_summary",
	"loop_detection_notice",
	"mistake_stop_notice",
	// Tagged at the live-runtime layer (agent-runtime.ts's
	// addUserReminderMessage) - included here too since metadata survives the
	// AgentMessage <-> LlmsProviders.Message conversion (agent-message-codec.ts),
	// so a reminder can end up persisted into the stored conversation.
	"completion_reminder",
]);

type GenericMessage = LlmsProviders.Message | LlmsProviders.MessageWithMetadata;

function readMessageMetadata(
	message: GenericMessage,
): Record<string, unknown> | undefined {
	return "metadata" in message &&
		message.metadata &&
		typeof message.metadata === "object" &&
		!Array.isArray(message.metadata)
		? (message.metadata as Record<string, unknown>)
		: undefined;
}

/**
 * A stored/persisted message counts as a genuine user-initiated turn only if:
 *  - its role is "user",
 *  - it isn't tagged as one of the synthetic system-injected kinds above, and
 *  - its content carries at least one block that isn't a tool_result (tool
 *    results are modeled as `role: "user"` messages in this wire format - see
 *    ToolResultContent in @cline/shared - so a message consisting solely of
 *    tool_result blocks is an internal continuation, not a user turn). A
 *    message mixing real content with a tool_result still counts as genuine.
 */
export function isGenuineUserPromptMessage(message: GenericMessage): boolean {
	if (message.role !== "user") {
		return false;
	}
	const kind = readMessageMetadata(message)?.kind;
	if (typeof kind === "string" && SYNTHETIC_USER_MESSAGE_KINDS.has(kind)) {
		return false;
	}
	const content = message.content;
	if (typeof content === "string") {
		return content.trim().length > 0;
	}
	if (!Array.isArray(content) || content.length === 0) {
		return false;
	}
	return content.some((block) => block.type !== "tool_result");
}

export function countGenuineUserPromptMessages(
	messages: readonly GenericMessage[],
): number {
	let count = 0;
	for (const message of messages) {
		if (isGenuineUserPromptMessage(message)) {
			count += 1;
		}
	}
	return count;
}
