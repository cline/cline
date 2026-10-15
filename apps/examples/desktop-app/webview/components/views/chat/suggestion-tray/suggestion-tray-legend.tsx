"use client";

import type { ComposerSuggestionItem } from "@cline/shared/browser";
import { cn } from "@/lib/utils";
import {
	type SuggestionVerb,
	suggestionVerbAriaKeys,
	suggestionVerbKbd,
	suggestionVerbWord,
} from "./suggestion-tray-keycaps";
import type { SuggestionTrayPartProps } from "./suggestion-tray-shared";

/** A verb with a key button; Undo has its key (⌘3) and the sent line's button instead. */
type LegendVerb = Exclude<SuggestionVerb, "undo">;

/** The key buttons, in the order the row shows them; each acts on the highlighted suggestion as its keys do. */
const LEGEND_VERBS: readonly LegendVerb[] = ["use", "send", "skip", "refresh"];

const LEGEND_LABEL = "Act on the highlighted suggestion";
const CHOOSE_HINT = "↑↓ to choose";

/** Each key's tooltip: what it does, whatever the highlighted suggestion says. */
const KEY_TITLES: Readonly<Record<LegendVerb, string>> = {
	use: "Put the highlighted suggestion in the message box",
	send: "Send the highlighted suggestion now",
	skip: "Skip the highlighted suggestion",
	refresh: "Suggest a new set",
};

/** Send's tooltip while the highlighted row is Use only. */
const UNSENDABLE_TITLE = "Use it first: this one isn't sent as it is";

const KEY_CLASS =
	"inline-flex h-5 items-center gap-1 rounded-md bg-muted px-[7px] text-[11px] font-medium whitespace-nowrap text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default disabled:opacity-45";

/** A key that acts: the pointer, and the hover that lifts it. */
const KEY_LIVE_CLASS =
	"cursor-pointer enabled:hover:bg-border enabled:hover:text-foreground";

/** A key that refuses the highlighted suggestion: greyed, with no hover. */
const KEY_REFUSED_CLASS = "cursor-default opacity-45";

/** Send held down while its verdict is out, up to 300 ms. */
const KEY_PRESSED_CLASS = "bg-border text-foreground";

/**
 * A key's accessible name: New set's own words; a refused Send's word and
 * reason, so the visible "Send" stays in the name; else the verb and the
 * prompt it acts on.
 */
function keyName(
	verb: LegendVerb,
	target: ComposerSuggestionItem | undefined,
	unsendable: boolean,
): string {
	if (verb === "refresh") return KEY_TITLES.refresh;
	if (verb === "send" && unsendable)
		return `${suggestionVerbWord(verb)} — ${UNSENDABLE_TITLE}`;
	return target
		? `${suggestionVerbWord(verb)}: ${target.prompt}`
		: suggestionVerbWord(verb);
}

/**
 * The key row above the tray, 12 px in from the message box's outer edge,
 * each button acting on the highlighted suggestion as its keys do. Greyed out
 * while a set loads, so the row keeps its 24 px slot and the chat never
 * moves. On a Use-only row Send stays focusable and says why it refuses; a
 * click still dispatches, and the tray answers it as it answers ⇧⌘1.
 */
export function SuggestionTrayLegend({
	suggestions,
	dispatch,
	view,
}: SuggestionTrayPartProps) {
	const target = view.mode === "ready" ? view.highlighted : undefined;
	const canRefresh = view.mode === "ready" && view.canRefresh;
	const unsendable = target ? !target.sendable : false;
	const sending =
		target !== undefined && suggestions.sendingItemId === target.id;
	return (
		<div
			aria-label={LEGEND_LABEL}
			className="mx-3 mb-1 flex h-5 items-center justify-end gap-1"
			data-testid="suggestion-legend"
			role="toolbar"
		>
			<span className="mr-1 text-[11px] text-muted-foreground">
				{CHOOSE_HINT}
			</span>
			{LEGEND_VERBS.map((verb) => {
				const refused = verb === "send" && unsendable;
				const pressed = verb === "send" && sending;
				return (
					<button
						aria-disabled={refused || pressed || undefined}
						aria-keyshortcuts={suggestionVerbAriaKeys(verb)}
						aria-label={keyName(verb, target, unsendable)}
						data-pressed={pressed || undefined}
						className={cn(
							KEY_CLASS,
							refused ? KEY_REFUSED_CLASS : KEY_LIVE_CLASS,
							pressed && KEY_PRESSED_CLASS,
						)}
						data-verb={verb}
						disabled={!target || (verb === "refresh" && !canRefresh)}
						key={verb}
						onClick={() => dispatch(verb, "pointer")}
						title={refused ? UNSENDABLE_TITLE : KEY_TITLES[verb]}
						type="button"
					>
						<span className="font-mono text-[10.5px] text-foreground">
							{suggestionVerbKbd(verb)}
						</span>
						{suggestionVerbWord(verb)}
					</button>
				);
			})}
		</div>
	);
}
