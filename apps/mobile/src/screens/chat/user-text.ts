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
	const match = USER_INPUT_ENVELOPE_RE.exec(stripLeadingModeNotices(trimmed));
	if (!match) {
		return { text: raw, unwrapped: false };
	}
	const attrs = match[1] ?? "";
	// A greedy body plus an anchored close tag means a *nested* envelope keeps its
	// inner tags rather than silently dropping the tail after the first close.
	const body = match[2] ?? "";
	const mode = MODE_ATTRIBUTE_RE.exec(attrs)?.[1]?.toLowerCase();
	// Runtime mode switches may precede the envelope or its body. Only their
	// exact generated prefix is presentation metadata; arbitrary XML (including
	// examples of mode_notice in code/prose) remains the person's text.
	return {
		text: stripLeadingModeNotices(body.trim()),
		...(isUserInputMode(mode) ? { mode } : {}),
		unwrapped: true,
	};
}

function stripLeadingModeNotices(text: string): string {
	const open = "<mode_notice>";
	const close = "</mode_notice>";
	let offset = 0;
	while (text.startsWith(open, offset)) {
		const end = text.indexOf(close, offset + open.length);
		if (end === -1) break;
		const notice = text.slice(offset + open.length, end);
		if (
			!/^The user switched from (?:act|plan) mode to (?:act|plan) mode before sending this message\.$/.test(
				notice,
			)
		)
			break;
		offset = end + close.length;
		while (offset < text.length && /\s/.test(text[offset] ?? "")) offset += 1;
	}
	return text.slice(offset);
}

function isUserInputMode(value?: string): value is UserInputMode {
	return value === "act" || value === "plan" || value === "yolo";
}

/** Sentence-case chip copy for a mode: `act` → "Act". */
export function userInputModeLabel(mode: UserInputMode): string {
	return mode.charAt(0).toUpperCase() + mode.slice(1);
}
