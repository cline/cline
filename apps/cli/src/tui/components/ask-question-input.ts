import type { KeyEvent } from "@opentui/core";

type PrintableKeyEvent = Pick<
	KeyEvent,
	"ctrl" | "meta" | "super" | "hyper" | "sequence"
>;

export function getPrintableKeyText(key: PrintableKeyEvent): string | null {
	if (key.ctrl || key.meta || key.super || key.hyper || !key.sequence) {
		return null;
	}

	const firstCharCode = key.sequence.charCodeAt(0);
	if (firstCharCode < 32 || firstCharCode === 127) {
		return null;
	}

	return key.sequence;
}
