/**
 * Action follow-through guard.
 *
 * Detects no-tool turns that describe a concrete next action ("I'll run...",
 * "Checking...", "Plan:\n1. ...") before the runtime treats them as complete.
 * This is a best-effort text heuristic: the runtime caps it to one nudge per
 * run, and the nudge leaves an escape hatch when no tool is actually needed.
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

// Gerund forms used by ACTION_NARRATION.
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

// First-person near-future intent, e.g. "I'll run" or "Let me check".
const ACTION_PROMISE = new RegExp(
	String.raw`\b(?:now\s+i['’]?m|i['’]?m\s+now|i\s+am\s+now|i['’]?ll|i\s+will|i['’]?m\s+going\s+to|i\s+am\s+going\s+to|let\s+me|next,?\s+i['’]?ll|next,?\s+i\s+will)\b[\s\S]{0,40}\b(?:${ACTION_VERBS})\b`,
	"i",
);

// Present-progressive / imperative narration, anchored to clause starts to
// avoid matching ordinary explanations mid-sentence.
const ACTION_NARRATION = new RegExp(
	String.raw`(?:^|[.!?]\s+)(?:(?:${ACTION_GERUNDS})\b|proceeding\s+to\s+(?:${ACTION_VERBS})\b|the\s+next\s+(?:step|thing)\s+(?:is\s+)?to\s+(?:${ACTION_VERBS})\b|i\s+need\s+to\s+(?:${ACTION_VERBS})\b|i\s+should\s+now\s+(?:${ACTION_VERBS})\b)`,
	"im",
);

// Enumerated "Plan:" / "Next steps:" block.
const ACTION_PLAN = new RegExp(
	String.raw`^\s*(?:plan|next\s+steps?)\s*:\s*\n\s*1[.)]\s+\S`,
	"im",
);

// Answer / recommendation / question / permission-ask suppressors.
const SUPPRESSORS: RegExp[] = [
	/\?\s*$/,
	/\b(?:would\s+you\s+like|do\s+you\s+want\s+me\s+to|shall\s+i|should\s+i|let\s+me\s+know|want\s+me\s+to|can\s+i\s+help)\b/i,
	/\b(?:you\s+could|you\s+might|you\s+should|you\s+can|you['’]?ll\s+need\s+to|i['’]?d\s+suggest|i\s+suggest|i\s+recommend|consider|one\s+option|if\s+you\s+want|it['’]?s\s+your\s+call|up\s+to\s+you|your\s+decision|your\s+call)\b/i,
	/\b(?:i['’]?ve|i\s+have\s+(?:already\s+)?(?:done|made|updated|created|fixed|added|removed)|i\s+just|already\s+(?:done|updated|created|fixed)|done\.|completed\.|fixed\.)\b/i,
];

export interface ActionFollowThroughGuardContext {
	assistantText: string;
}

export const ACTION_FOLLOW_THROUGH_NUDGE =
	"[SYSTEM] Your previous response described an action you would take but did not call any tool to do it. " +
	"If that action is needed, call the appropriate tool now in this response. " +
	"If no tool is actually needed and the task is already complete, briefly say so and stop.";

/** Pure/exported for direct unit testing. */
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

export function createActionFollowThroughGuard(): (
	context: ActionFollowThroughGuardContext,
) => string | undefined {
	return ({ assistantText }) =>
		looksLikeUnfulfilledAction(assistantText)
			? ACTION_FOLLOW_THROUGH_NUDGE
			: undefined;
}
