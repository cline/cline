/**
 * The suggestion tray's verbs and their keys: ⌘1 Use, ⇧⌘1 Send, ⌘2 Skip,
 * ⌥⌘2 New set and ⌘3 Undo on macOS, Ctrl in place of ⌘ elsewhere.
 */

export type SuggestionVerb = "use" | "send" | "skip" | "undo" | "refresh";

export function isMacPlatform(): boolean {
	if (typeof navigator === "undefined") return false;
	return /mac/i.test(navigator.platform || navigator.userAgent);
}

/** "⇧" on macOS, "Shift+" elsewhere. */
export function shiftKeyLabel(): string {
	return isMacPlatform() ? "⇧" : "Shift+";
}

const VERB_LABELS: Record<SuggestionVerb, string> = {
	use: "Use",
	send: "Send",
	skip: "Skip",
	undo: "Undo",
	refresh: "New set",
};

/** The digit a plain-chord verb sits on; digits are verbs, never ranks. */
const VERB_DIGIT: Record<
	Exclude<SuggestionVerb, "send" | "refresh">,
	string
> = {
	use: "1",
	skip: "2",
	undo: "3",
};

export function suggestionVerbWord(verb: SuggestionVerb): string {
	return VERB_LABELS[verb];
}

/** The verb's keycap as the tray prints it: ⌘, ⇧ and ⌥ on macOS, "Ctrl+", "Shift+" and "Alt+" elsewhere. */
export function suggestionVerbKbd(verb: SuggestionVerb): string {
	if (verb === "send") return isMacPlatform() ? "⇧⌘1" : "Ctrl+Shift+1";
	if (verb === "refresh") return isMacPlatform() ? "⌥⌘2" : "Ctrl+Alt+2";
	return isMacPlatform() ? `⌘${VERB_DIGIT[verb]}` : `Ctrl+${VERB_DIGIT[verb]}`;
}

/** The verb's chord as `aria-keyshortcuts` names it ("Meta+1", "Shift+Control+1", "Alt+Meta+2"). */
export function suggestionVerbAriaKeys(verb: SuggestionVerb): string {
	const modifier = isMacPlatform() ? "Meta" : "Control";
	if (verb === "send") return `Shift+${modifier}+1`;
	if (verb === "refresh") return `Alt+${modifier}+2`;
	return `${modifier}+${VERB_DIGIT[verb]}`;
}

const DIGIT_VERBS: ReadonlyMap<string, SuggestionVerb> = new Map([
	["Digit1", "use"],
	["Numpad1", "use"],
	["Digit2", "skip"],
	["Numpad2", "skip"],
	["Digit3", "undo"],
	["Numpad3", "undo"],
]);

/**
 * Matched on `event.code`, never `event.key`: on AZERTY ⌘1 reports "&", and
 * ⌥ changes the character on the Mac. Shift turns Use into Send and is refused
 * on every other digit; Alt (⌥) turns Skip into New set, on Skip's own key,
 * and is refused on every other digit and together with Shift.
 */
export function suggestionDigitVerb(
	code: string,
	shift = false,
	alt = false,
): SuggestionVerb | null {
	const verb = DIGIT_VERBS.get(code) ?? null;
	if (alt) return !shift && verb === "skip" ? "refresh" : null;
	if (!shift) return verb;
	return verb === "use" ? "send" : null;
}
