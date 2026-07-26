/**
 * Narration policy — pure map from work/control events to optional narration.
 */

import type { DriveEvent } from "@cline/shared";

export type NarrationDensity = "decision-points" | "every-tool";

export type NarrationCandidate = {
	readonly text: string;
	readonly relatedWorkEventId?: string;
};

const DECISION_POINT_TYPES = new Set<DriveEvent["type"]>([
	"work.plan_step",
	"work.decision",
	"work.test_result",
	"work.command",
	"control.mode",
]);

function isDecisionPoint(event: DriveEvent): boolean {
	if (!DECISION_POINT_TYPES.has(event.type)) {
		return false;
	}
	if (event.type === "work.test_result") {
		return !event.passed;
	}
	if (event.type === "work.command") {
		return event.failed === true;
	}
	return true;
}

function isWorkOrModeEvent(event: DriveEvent): boolean {
	return event.track === "work" || event.type === "control.mode";
}

function defaultText(event: DriveEvent): string | null {
	switch (event.type) {
		case "work.plan_step":
			return `Next: ${event.title} (${event.status})`;
		case "work.decision":
			return `Decision — ${event.title}: ${event.choice}`;
		case "work.test_result":
			return event.passed
				? `Tests passed: ${event.label}`
				: `Tests failed: ${event.label}`;
		case "work.command":
			return event.failed
				? `Command failed: ${event.command}`
				: `Ran: ${event.command}`;
		case "work.edit":
			return `Edited ${event.path}`;
		case "control.mode":
			return `Switched to ${event.subMode}`;
		default:
			return null;
	}
}

/**
 * Returns a narration candidate when density says the event should be spoken,
 * otherwise null. Callers mint the `conversation.narration` DriveEvent.
 */
export function narrate(
	event: DriveEvent,
	density: NarrationDensity,
	overrideText?: string,
): NarrationCandidate | null {
	if (!isWorkOrModeEvent(event)) {
		return null;
	}

	const emit =
		density === "every-tool"
			? event.track === "work" || event.type === "control.mode"
			: isDecisionPoint(event);

	if (!emit) {
		return null;
	}

	const text = overrideText ?? defaultText(event);
	if (!text) {
		return null;
	}

	return {
		text,
		relatedWorkEventId: event.track === "work" ? event.id : undefined,
	};
}
