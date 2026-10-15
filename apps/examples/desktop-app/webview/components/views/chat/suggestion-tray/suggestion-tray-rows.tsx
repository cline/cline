"use client";

import type {
	ComposerSuggestionItem,
	PluginUiIcon,
	PluginUiInput,
	PluginUiTone,
} from "@cline/shared/browser";
import type { RefObject } from "react";
import { cn } from "@/lib/utils";
import { suggestionIcon } from "./suggestion-tray-icons";
import {
	OPTION_ID_PREFIX,
	type ReadySuggestionsView,
	ROW_GRID_WITH_END,
	type SuggestionTrayPartProps,
} from "./suggestion-tray-shared";
import { SourceLink } from "./suggestion-tray-source";
import {
	TONE_CHIP_CLASSES,
	TONE_EDGE_CLASSES,
	TONE_TEXT_CLASSES,
} from "./suggestion-tray-tones";

/**
 * The word's ink on the card's why line: each tone's text step, which for
 * Continue is the accent's text step (the tile's own ink) rather than the
 * primary fill the shared map gives it.
 */
const WORD_CLASSES: Record<PluginUiTone, string> = {
	...TONE_TEXT_CLASSES,
	continue: "text-accent-foreground",
};

/**
 * The card tile's fill where the tone's own fill matches the card. In dark
 * the raised card is `bg-muted`, and so is the Finish tile, so the tile
 * would vanish; it steps up to the next neutral (`border`).
 */
const CARD_TILE_DARK_CLASSES: Partial<Record<PluginUiTone, string>> = {
	finish: "dark:bg-border",
	neutral: "dark:bg-border",
};

/**
 * The word as a tone tile in the tray's fixed 32 px column: on the highlighted
 * card it fills the card's height with an 18 px icon, on a row it is a 20 px
 * square with a 12 px icon. The word is printed beside it (the card's why
 * line) or read out to assistive technology (a row), never carried by colour
 * alone.
 */
export function ToneTile({
	label,
	tone,
	icon,
	size,
}: {
	label: string;
	tone: PluginUiTone;
	icon?: PluginUiIcon;
	size: "card" | "row";
}) {
	const Icon = suggestionIcon(icon);
	return (
		<span
			aria-hidden="true"
			className={cn(
				"flex items-center justify-center",
				size === "card"
					? "min-h-8 self-stretch rounded-md"
					: "size-5 justify-self-center rounded-[4.5px]",
				TONE_CHIP_CLASSES[tone],
				size === "card" && CARD_TILE_DARK_CLASSES[tone],
			)}
			data-testid="suggestion-tile"
			title={label}
		>
			<Icon
				className={
					size === "card" ? "size-[18px]" : "size-3 [stroke-width:2.25]"
				}
			/>
		</span>
	);
}

export type SuggestionTrayRowsProps =
	SuggestionTrayPartProps<ReadySuggestionsView> & {
		/** The listbox element; the keys read focus inside it. */
		listRef: RefObject<HTMLDivElement | null>;
		/** Use on any row, highlighted or not (a double-click). */
		fillComposer: (item: ComposerSuggestionItem, input: PluginUiInput) => void;
		/** The set arrived since the tray last drew rows: the entrance animation runs. */
		fresh: boolean;
	};

/** The why line, with a plain source folded in when the row is too narrow to give it its own place. */
function whyText(
	item: ComposerSuggestionItem,
	placement: ReadySuggestionsView["rows"][number]["source"],
): string | undefined {
	if (placement !== "in-detail" || !item.source) return item.detail;
	return item.detail
		? `${item.detail} · ${item.source.label}`
		: item.source.label;
}

/**
 * The ready set as a listbox: the highlighted suggestion as a 44 px card (a
 * tone tile that stretches with it, the prompt on up to two lines, the word
 * leading the why line, the source at its end) and the others as 28 px rows.
 * Every prompt starts at the same x. A compact tray shows only the card.
 */
export function SuggestionTrayRows({
	suggestions,
	view,
	listRef,
	fillComposer,
	fresh,
}: SuggestionTrayRowsProps) {
	const rows =
		view.density === "compact"
			? view.rows.filter((row) => row.highlighted)
			: view.rows;
	return (
		<div
			aria-activedescendant={`${OPTION_ID_PREFIX}${view.highlighted.id}`}
			aria-label="Suggested next messages"
			className={cn(
				"flex flex-col gap-0.5 outline-none",
				fresh && "suggestion-tray-in",
			)}
			data-testid="suggestion-rows"
			ref={listRef}
			role="listbox"
			tabIndex={0}
		>
			{rows.map(({ item, highlighted, source }) => {
				if (!highlighted) {
					return (
						// biome-ignore lint/a11y/useKeyWithClickEvents: rows never take focus (tabIndex -1); the listbox's own keys move the highlight
						<div
							aria-selected={false}
							className={cn(
								ROW_GRID_WITH_END,
								"cursor-pointer rounded-md text-foreground hover:bg-surface-hover",
							)}
							id={`${OPTION_ID_PREFIX}${item.id}`}
							key={item.id}
							onClick={() => suggestions.highlight(item.id)}
							onDoubleClick={() => fillComposer(item, "pointer")}
							role="option"
							tabIndex={-1}
							title={item.prompt}
						>
							<ToneTile
								icon={item.icon}
								label={item.label}
								size="row"
								tone={item.tone}
							/>
							<span className="min-w-0 truncate text-[13px]">
								<span className="sr-only">{item.label}: </span>
								{item.prompt}
							</span>
							<SourceLink item={item} placement={source} />
						</div>
					);
				}
				const why = whyText(item, source);
				return (
					<div
						aria-selected
						className={cn(
							"grid min-h-11 grid-cols-[2rem_minmax(0,1fr)] gap-x-2 rounded-lg border bg-background py-1 pr-2 pl-1.5 text-foreground dark:bg-muted",
							TONE_EDGE_CLASSES[item.tone],
						)}
						id={`${OPTION_ID_PREFIX}${item.id}`}
						key={item.id}
						onDoubleClick={() => fillComposer(item, "pointer")}
						role="option"
						tabIndex={-1}
						title={item.prompt}
					>
						<ToneTile
							icon={item.icon}
							label={item.label}
							size="card"
							tone={item.tone}
						/>
						<span className="flex min-w-0 flex-col justify-center">
							<span className="line-clamp-2 text-[13px] leading-[18px] font-medium whitespace-pre-line">
								{item.prompt}
							</span>
							<span className="flex h-4 min-w-0 items-center gap-1.5">
								<span className="min-w-0 truncate text-[11.5px] leading-4 text-muted-foreground">
									<b className={cn("font-semibold", WORD_CLASSES[item.tone])}>
										{item.label}
									</b>
									{why ? ` · ${why}` : null}
								</span>
								<SourceLink
									className="ml-auto h-4"
									item={item}
									placement={source}
								/>
							</span>
						</span>
					</div>
				);
			})}
		</div>
	);
}
