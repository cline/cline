import { sanitizeSurrogates } from "../../../llms/ai-sdk-format";

const ELLIPSIS = "…";
const TAB = /\t/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping C0/C1 controls (all but "\n") is the purpose of this pattern
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;
const BIDI_AND_ZERO_WIDTH =
	/[\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
const WHITESPACE_RUN = /\s+/g;

/**
 * The text pass every state field gets: tabs become spaces; C0/C1 controls
 * other than "\n", bidi and zero-width characters are removed; lone
 * surrogates become U+FFFD; whitespace runs collapse and the ends are trimmed;
 * then the text is clamped by code points with "…". `multiline` (for `prompt`)
 * keeps interior whitespace and newlines and only trims the ends. Idempotent.
 */
export function clampPluginUiText(
	value: string,
	maxChars: number,
	options: { multiline?: boolean } = {},
): string {
	const visible = sanitizeSurrogates(
		value
			.replace(TAB, " ")
			.replace(CONTROL_CHARACTERS, "")
			.replace(BIDI_AND_ZERO_WIDTH, ""),
	);
	const text = options.multiline
		? visible.trim()
		: visible.replace(WHITESPACE_RUN, " ").trim();
	const codePoints = Array.from(text);
	if (codePoints.length <= maxChars) return text;
	return `${codePoints
		.slice(0, Math.max(0, maxChars - 1))
		.join("")
		.trimEnd()}${ELLIPSIS}`;
}
