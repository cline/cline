import type { ClineMessage } from "@shared/ExtensionMessage"

/**
 * Messages that settle "what happened last" in a transcript: an agent turn's
 * outcome, or the user taking their next turn. Anything else (tool rows, api
 * bookkeeping, reasoning, checkpoints) can trail the turn that produced it
 * without changing what the conversation is waiting on.
 */
type ConversationOutcome = "plan" | "other"

function outcomeOf(message: ClineMessage): ConversationOutcome | undefined {
	if (message.type === "say") {
		switch (message.say) {
			// Turn-final plan-mode response, retagged from the turn's last text row
			// at turn end (and rehydrated the same way when a task is reopened).
			case "plan_completion_result":
				return "plan"
			// An act-mode turn's answer or attempt_completion, or the user's own
			// next message — all of which mean the last plan (if any) is spent.
			case "completion_result":
			case "user_feedback":
				return "other"
			default:
				return undefined
		}
	}
	switch (message.ask) {
		// Legacy classic-path plan response; the SDK path retags text instead.
		case "plan_mode_respond":
			return "plan"
		case "completion_result":
		// The agent asked something rather than presenting a plan.
		case "followup":
			return "other"
		default:
			return undefined
	}
}

/**
 * Whether the transcript's most recent outcome is a plan the user has not acted
 * on yet.
 *
 * Used to decide whether a Plan → Act toggle should carry an automatic "continue
 * with the approved plan" message. The turn phase cannot answer this on its own:
 * `awaiting_followup` only means "the turn ended and it's the user's move", which
 * is equally true after an act-mode answer or a follow-up question, and it
 * survives mode toggles — so an accidental Act → Plan → Act round trip would
 * otherwise ask the agent to act on a plan that was never presented.
 */
export function endsOnPresentedPlan(messages: ClineMessage[]): boolean {
	for (let i = messages.length - 1; i >= 0; i--) {
		const outcome = outcomeOf(messages[i])
		if (outcome) {
			return outcome === "plan"
		}
	}
	return false
}
