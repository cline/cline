/**
 * Presentation-layer unwrapping of the runtime's `<user_input mode="...">`
 * envelope.
 *
 * The hub persists every user turn wrapped by `formatUserInputBlock`
 * (`sdk/packages/shared/src/prompt/format.ts`):
 *
 *     `<user_input mode="${mode}">${input}</user_input>`
 *
 * The transcript the phone hydrates therefore contains the envelope, not just
 * what the human typed. Unwrapping happens *here* — at render time — and not in
 * the session reducer: the reducer's job is to project protocol events
 * faithfully, and a display concern must not rewrite the transcript model.
 *
 * The match is deliberately narrow. The pattern is anchored to the whole
 * (trimmed) string, the tag name must be exactly `user_input`, and anything that
 * does not match is returned untouched — a person legitimately asking "what does
 * `<user_input>` mean?" must still see their own words.
 */

import { stripModeNotices } from "@cline/shared";

/** The tag name is anchored at both ends, so there is a single start position
 * to scan from and no lazy-quantifier backtracking blowup on hostile content. */
const USER_INPUT_ENVELOPE_RE =
	/^<user_input\b([^>]*)>([\s\S]*)<\/user_input>$/i;

const MODE_ATTRIBUTE_RE = /\bmode="(act|plan|yolo)"/i;

/** The interaction mode a message was sent in, as recorded by the wrapper. */
export type UserInputMode = "act" | "plan" | "yolo";

export interface UserInputEnvelope {
	/** The human-authored text, with the envelope removed when one was found. */
	text: string;
	/** Present only when the wrapper carried a recognised `mode` attribute. */
	mode?: UserInputMode;
	/** True when an envelope actually matched and was stripped. */
	unwrapped: boolean;
}

/**
 * Splits a persisted user message into the text a person should read and the
 * mode it was sent in.
 *
 * Returns the input verbatim (`unwrapped: false`) whenever the envelope does not
 * match exactly: a bare opening tag, a missing closing tag, prose that merely
 * mentions the tag, or a different tag entirely. Nothing else about the content
 * is rewritten — no other tags are stripped and no markdown is touched.
 */
export function parseUserInputEnvelope(raw: string): UserInputEnvelope {
	const trimmed = raw.trim();
	const match = USER_INPUT_ENVELOPE_RE.exec(trimmed);
	if (!match) {
		return { text: raw, unwrapped: false };
	}
	const attrs = match[1] ?? "";
	// A greedy body plus an anchored close tag means a *nested* envelope keeps its
	// inner tags rather than silently dropping the tail after the first close.
	const body = match[2] ?? "";
	const mode = MODE_ATTRIBUTE_RE.exec(attrs)?.[1]?.toLowerCase();
	// A plan<->act switch prepends `<mode_notice>` *inside* the envelope. The SDK
	// strips it at its own display boundaries; reuse that exact implementation
	// rather than a second regex, so the two can never disagree about the shape.
	return {
		text: stripModeNotices(body),
		...(isUserInputMode(mode) ? { mode } : {}),
		unwrapped: true,
	};
}

function isUserInputMode(value?: string): value is UserInputMode {
	return value === "act" || value === "plan" || value === "yolo";
}

/** Sentence-case chip copy for a mode: `act` → "Act". */
export function userInputModeLabel(mode: UserInputMode): string {
	return mode.charAt(0).toUpperCase() + mode.slice(1);
}
