import type { StageCard, StagePin } from "@cline/shared";

export type HumanPinKind = StagePin["kind"];

/** Browser selection text when available (Drive share selection pin). */
export function readBrowserSelectionText(): string | undefined {
	if (typeof window === "undefined" || !window.getSelection) {
		return undefined;
	}
	const text = window.getSelection()?.toString().trim();
	return text && text.length > 0 ? text : undefined;
}

export function lastCardOfCategory(
	cards: readonly StageCard[],
	category: StageCard["category"],
): StageCard | undefined {
	for (let i = cards.length - 1; i >= 0; i -= 1) {
		if (cards[i]?.category === category) {
			return cards[i];
		}
	}
	return undefined;
}

/** Defaults for You-take-stage kind picker (selection / file / terminal). */
export function buildHumanPinDefaults(
	cards: readonly StageCard[],
): Record<HumanPinKind, StagePin> {
	const selection = readBrowserSelectionText();
	const edit = lastCardOfCategory(cards, "edit");
	const command = lastCardOfCategory(cards, "command");

	return {
		selection: {
			kind: "selection",
			label: selection
				? selection.length > 48
					? `${selection.slice(0, 45)}…`
					: selection
				: "Current selection",
			ref: selection ?? "No text selected — select code in Chat and pin again.",
		},
		file: {
			kind: "file",
			label: edit?.title ?? "Shared file",
			ref: edit?.summary?.split("\n")[0] ?? edit?.title ?? "Enter a file path",
		},
		terminal: {
			kind: "terminal",
			label: command?.title ?? "Terminal",
			ref: command?.summary ?? command?.title ?? "No recent command output",
		},
	};
}
