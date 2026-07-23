// This file is the live-runtime counterpart of
// ../session/checkpoint-message-filter.ts: it defines "a genuine user turn"
// for the `AgentMessage` shape used by the agent runtime's snapshot
// (`sdk/packages/agents/src/agent-runtime.ts`), as opposed to the persisted
// `LlmsProviders.Message` shape used for stored conversation history. The two
// shapes model tool results differently (a distinct `role: "tool"` here, vs.
// `tool_result` content blocks folded into `role: "user"` there), so they
// need separate filters - do not try to unify them.
import type { AgentMessage } from "@cline/shared";

/**
 * Metadata `kind` tags that mark a `role: "user"` AgentMessage as a
 * synthetic, system-injected message rather than something the user typed.
 * Keep in sync with the tags applied in agent-runtime.ts (addUserReminderMessage)
 * and, transitively, whatever survives from the persisted layer's own tags
 * (see checkpoint-message-filter.ts) if a compacted/resumed conversation is
 * re-seeded as AgentMessage initialMessages.
 */
const SYNTHETIC_USER_MESSAGE_KINDS = new Set([
	"completion_reminder",
	"recovery_notice",
	"compaction_summary",
	"loop_detection_notice",
	"mistake_stop_notice",
]);

/**
 * A live AgentMessage counts as a genuine user-initiated turn only if:
 *  - its role is "user" (tool results have their own "tool" role here, so
 *    unlike the persisted message shape, no content-block filtering is
 *    needed to exclude them), and
 *  - it isn't tagged as one of the synthetic system-injected kinds above.
 */
export function isGenuineUserPromptMessage(message: AgentMessage): boolean {
	if (message.role !== "user") {
		return false;
	}
	const kind = message.metadata?.kind;
	return !(typeof kind === "string" && SYNTHETIC_USER_MESSAGE_KINDS.has(kind));
}

export function countGenuineUserPromptMessages(
	messages: readonly AgentMessage[],
): number {
	let count = 0;
	for (const message of messages) {
		if (isGenuineUserPromptMessage(message)) {
			count += 1;
		}
	}
	return count;
}
