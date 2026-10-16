import type { AgentMessage } from "@cline/shared";
import { editBucket } from "../labels/labels";
import type { OfferedSet } from "../tray/tray";
import { lastPersonMessage } from "../turn/run-count";
import type { SessionCore } from "./core";
import { rowFields, type TurnState } from "./turn-state";

/**
 * A model request is about to go out. When it carries a new message from the
 * person, that message is labelled against the set on screen (or the explicit
 * Use/Send intent) and the set is superseded. Later requests in the same run,
 * and a run on the same message (a resume), find nothing new and label nothing.
 */
export function outgoing(
	core: SessionCore,
	messages: readonly AgentMessage[],
): void {
	const message = lastPersonMessage(messages);
	if (!message || message.id === core.lastTurn?.userMessageId) return;
	core.runUnderway = true;
	core.generation += 1;
	const set = core.shown;
	const state = core.state;
	if (set && state) {
		labelMessage(core, set, state, message.text);
		core.labelFor(set, "superseded", { cause: "message" });
	}
	if (set || core.lastPush?.state === "computing") core.off("message");
}

function labelMessage(
	core: SessionCore,
	set: OfferedSet,
	state: TurnState,
	text: string,
): void {
	const intent = state.pendingIntent;
	if (intent?.verb === "send" && intent.candidate.prompt === text) {
		core.labelFor(intent.offer, "do", {
			...rowFields(intent.candidate, intent.position),
			input: intent.input,
			msSinceExposed: intent.msSinceExposed,
		});
		return;
	}
	if (intent?.verb === "use") {
		const bucket = editBucket(intent.candidate.prompt, text);
		if (bucket !== "large") {
			core.labelFor(intent.offer, "adjust_sent", {
				...rowFields(intent.candidate, intent.position),
				bucket,
				chars: text.length,
				msToSend: Math.max(0, Date.now() - intent.at),
				input: intent.input,
			});
			return;
		}
		core.labelFor(intent.offer, "adjust_abandoned", {
			candidateId: intent.candidate.id,
			cause: "different_message",
		});
		labelTypedInstead(core, set, state, text);
		return;
	}
	const buckets = set.candidates.map((item) => editBucket(item.prompt, text));
	const exact = buckets.indexOf("same");
	if (exact !== -1) {
		core.labelFor(set, "do", {
			...rowFields(set.candidates[exact], exact),
			input: "message",
		});
		return;
	}
	const close = buckets.indexOf("small");
	if (close !== -1) {
		core.labelFor(set, "adjust", {
			...rowFields(set.candidates[close], close),
			bucket: "small",
			input: "message",
		});
		return;
	}
	labelTypedInstead(core, set, state, text);
}

/** Typed instead counts only when the person saw the set. */
function labelTypedInstead(
	core: SessionCore,
	set: OfferedSet,
	state: TurnState,
	text: string,
): void {
	if (text && state.exposedOffers.size > 0)
		core.labelFor(set, "typed_instead", { typedText: text });
}
