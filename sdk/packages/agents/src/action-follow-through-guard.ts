/**
 * Action follow-through guard.
 *
 * Detects the "narrate an action, then stop without doing it" failure mode:
 * the model produces a no-tool assistant turn whose text announces a concrete
 * action it is about to take (e.g. "I'll run the tests", "Now I'm opening the
 * file", a "Plan:" block of imperative steps) but emits no tool call, so the
 * run would otherwise complete and the user has to nudge it to continue.
 *
 * This is intentionally conservative: it only fires on high-confidence
 * first-person near-future self-action phrasing, and suppresses on anything
 * that reads as an answer, recommendation, question, or request for input.
 * The agent runtime caps it to fire at most once per run, and the nudge it
 * returns includes an explicit escape hatch, so a false positive costs at most
 * one extra model round-trip and never forces a tool call.
 *
 * NOTE: this is a best-effort reliability heuristic, not a guarantee. It is a
 * text classifier and will miss wordings outside its patterns, and the nudge
 * only *asks* the model to follow through — the model can still decline. It
 * mitigates the common "narrate then stop" failure mode rather than enforcing
 * a deterministic tool-use contract. Telemetry (`agent.action_follow_through.*`)
 * is emitted so fire-rate and follow-through-rate can be measured and the
 * patterns tuned from real transcripts over time.
 */

const ACTION_VERBS = [
	"open",
	"opening",
	"run",
	"running",
	"fetch",
	"fetching",
	"update",
	"updating",
	"edit",
	"editing",
	"write",
	"writing",
	"apply",
	"applying",
	"push",
	"pushing",
	"create",
	"creating",
	"delete",
	"deleting",
	"remove",
	"removing",
	"replace",
	"replacing",
	"install",
	"installing",
	"build",
	"building",
	"check",
	"checking",
	"read",
	"reading",
	"search",
	"searching",
	"inspect",
	"inspecting",
	"modify",
	"modifying",
	"fix",
	"fixing",
	"add",
	"adding",
	"refactor",
	"refactoring",
	"rename",
	"renaming",
	"move",
	"moving",
	"generate",
	"generating",
	"implement",
	"implementing",
].join("|");

// Gerund forms of the action verbs, used by the present-progressive trigger
// below (e.g. "Checking the config now.", "Running the tests next.").
const ACTION_GERUNDS = [
	"opening",
	"running",
	"fetching",
	"updating",
	"editing",
	"writing",
	"applying",
	"pushing",
	"creating",
	"deleting",
	"removing",
	"replacing",
	"installing",
	"building",
	"checking",
	"reading",
	"searching",
	"inspecting",
	"modifying",
	"fixing",
	"adding",
	"refactoring",
	"renaming",
	"moving",
	"generating",
	"implementing",
	"proceeding",
].join("|");

// First-person near-future intent followed (within a short window) by a
// concrete action verb. e.g. "I'll run", "Now I'm opening", "Let me check".
const ACTION_PROMISE = new RegExp(
	String.raw`\b(?:now\s+i['’]?m|i['’]?m\s+now|i\s+am\s+now|i['’]?ll|i\s+will|i['’]?m\s+going\s+to|i\s+am\s+going\s+to|let\s+me|next,?\s+i['’]?ll|next,?\s+i\s+will)\b[\s\S]{0,40}\b(?:${ACTION_VERBS})\b`,
	"i",
);

// Present-progressive / imperative narration without an explicit "I will".
// Catches the common stall wordings that ACTION_PROMISE misses, e.g.
//   "Checking the config now."
//   "Proceeding to update the file."
//   "Running the tests next."
//   "The next thing is to run the tests."
//   "I need to inspect the logs."
// Anchored to a clause start (line start or sentence boundary) to keep
// false positives low.
const ACTION_NARRATION = new RegExp(
	String.raw`(?:^|[.!?]\s+)(?:(?:${ACTION_GERUNDS})\b|proceeding\s+to\s+(?:${ACTION_VERBS})\b|the\s+next\s+(?:step|thing)\s+(?:is\s+)?to\s+(?:${ACTION_VERBS})\b|i\s+need\s+to\s+(?:${ACTION_VERBS})\b|i\s+should\s+now\s+(?:${ACTION_VERBS})\b)`,
	"im",
);

// A "Plan:" / "Next steps:" block that begins an enumerated list of imperative
// steps. Strong signal of intended work that hasn't been executed.
const ACTION_PLAN = new RegExp(
	String.raw`^\s*(?:plan|next\s+steps?)\s*:\s*\n\s*1[.)]\s+\S`,
	"im",
);

// If any suppressor matches, the turn is treated as an answer / recommendation
// / question / request for input — NOT an unfulfilled action commitment.
const SUPPRESSORS: RegExp[] = [
	// Asks the user a question or for permission/confirmation.
	/\?\s*$/,
	/\b(?:would\s+you\s+like|do\s+you\s+want\s+me\s+to|shall\s+i|should\s+i|let\s+me\s+know|want\s+me\s+to|can\s+i\s+help)\b/i,
	// Recommendation / hypothetical framing rather than a commitment.
	/\b(?:you\s+could|you\s+might|you\s+should|you\s+can|you['’]?ll\s+need\s+to|i['’]?d\s+suggest|i\s+suggest|i\s+recommend|consider|one\s+option|if\s+you\s+want|it['’]?s\s+your\s+call|up\s+to\s+you|your\s+decision|your\s+call)\b/i,
	// Already-done / past tense — the work happened.
	/\b(?:i['’]?ve|i\s+have\s+(?:already\s+)?(?:done|made|updated|created|fixed|added|removed)|i\s+just|already\s+(?:done|updated|created|fixed)|done\.|completed\.|fixed\.)\b/i,
];

export interface ActionFollowThroughGuardContext {
	assistantText: string;
}

export const ACTION_FOLLOW_THROUGH_NUDGE =
	"[SYSTEM] Your previous response described an action you would take but did not call any tool to do it. " +
	"If that action is needed, call the appropriate tool now in this response. " +
	"If no tool is actually needed and the task is already complete, briefly say so and stop.";

/**
 * Returns `true` when the assistant text looks like an unfulfilled action
 * commitment that should be nudged. Pure/exported for direct unit testing.
 */
export function looksLikeUnfulfilledAction(assistantText: string): boolean {
	const text = assistantText.trim();
	if (!text) {
		return false;
	}
	for (const suppressor of SUPPRESSORS) {
		if (suppressor.test(text)) {
			return false;
		}
	}
	return (
		ACTION_PROMISE.test(text) ||
		ACTION_NARRATION.test(text) ||
		ACTION_PLAN.test(text)
	);
}

/**
 * Build a completion guard that nudges the model to follow through on a
 * described-but-not-executed action. Intended to be wired as
 * `completionPolicy.actionFollowThroughGuard`.
 */
export function createActionFollowThroughGuard(): (
	context: ActionFollowThroughGuardContext,
) => string | undefined {
	return ({ assistantText }) =>
		looksLikeUnfulfilledAction(assistantText)
			? ACTION_FOLLOW_THROUGH_NUDGE
			: undefined;
}
