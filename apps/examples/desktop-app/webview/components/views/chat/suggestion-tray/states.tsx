"use client";

import type {
	ComposerSuggestionItem,
	SuggestionsLocal,
	SuggestionsView,
} from "@cline/shared/browser";
import { EyeOff, MessageCircle, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { suggestionVerbAriaKeys, suggestionVerbKbd } from "./keycaps";
import { ToneTile } from "./rows";
import {
	ROW_GRID,
	ROW_GRID_WITH_END,
	type SuggestionTrayPartProps,
	TEXT_BUTTON_CLASSES,
} from "./shared";
import { TONE_DOT_CLASSES } from "./tones";

type ViewOf<M extends SuggestionsView["mode"]> = Extract<
	SuggestionsView,
	{ mode: M }
>;

const suggestionCount = (count: number) =>
	`${count} ${count === 1 ? "suggestion" : "suggestions"}`;
const YIELD_LINE = (count: number) =>
	`${suggestionCount(count)} · clear the message box to see them`;
const COLLAPSED_LINE = (count: number) =>
	`${suggestionCount(count)} hidden for this turn`;
const USED_LINE = "From a suggestion";
const EDITED_LINE = "Edited suggestion";
const WORKING_LINE = "Cline is working…";
const EMPTY_LINE = "Nothing obvious to suggest — type what you want next.";
const EXHAUSTED_LINE = "That's all the likely ones. Type what you want next.";
const UNAVAILABLE_LINE = "Couldn't get suggestions for this turn.";
const STALE_LINE = "Suggestions changed — check them before sending";
const OFF_LINE = (title: string) => `${title} · off for this chat`;
const TRY_AGAIN_LABEL = "Try again";
const TRY_AGAIN_TOOLTIP = "Suggest a new set";
const CLEAR_LABEL = "Clear";
const CLEAR_TOOLTIP = "Clear (Esc)";
const UNDO_LABEL = "Undo";
const UNDO_TOOLTIP = "Take the sent suggestion back";
const SHOW_LABEL = "Show";
const SHOW_TOOLTIP = "Show suggestions in this chat again";

/** The notes line's 22 px slot; the tone classes are the note's own. */
const NOTE_CLASSES =
	"flex h-[22px] items-center gap-1.5 rounded-md px-2 font-medium";

/** The skeleton bars' widths on the plain-row slots. */
const SKELETON_ROW_WIDTHS = ["w-[46%]", "w-[58%]", "w-[40%]", "w-[52%]"];

/** The item a local ref names, for the icon the ref itself does not carry. */
export function findSuggestionItem(
	local: SuggestionsLocal,
	itemId: string | undefined,
): ComposerSuggestionItem | undefined {
	if (!itemId) return undefined;
	return local.envelope?.state?.items.find((item) => item.id === itemId);
}

/** A refused Use or Send: the set changed under the key, for four seconds. */
export function SuggestionTrayStale() {
	return (
		<output
			className={cn(NOTE_CLASSES, "bg-warning-surface text-warning-text")}
			data-testid="suggestion-stale"
		>
			<TriangleAlert aria-hidden="true" className="size-3 shrink-0" />
			{STALE_LINE}
		</output>
	);
}

/**
 * A set computing, or a run going: the card and the plain rows as pulsing
 * placeholders in the same slots, so the chat never moves when the set lands.
 * A compact tray keeps only the card.
 */
export function SuggestionTraySkeleton({ rows }: { rows: number }) {
	const plainRows = SKELETON_ROW_WIDTHS.slice(0, Math.max(0, rows - 1));
	return (
		<div
			aria-hidden="true"
			className="flex flex-col gap-0.5"
			data-testid="suggestion-skeleton"
		>
			<div className="grid min-h-11 grid-cols-[2rem_minmax(0,1fr)] gap-x-2 rounded-lg border border-border py-1 pr-2 pl-1.5">
				<span className="min-h-8 self-stretch rounded-md bg-accent motion-safe:animate-pulse" />
				<span className="flex flex-col justify-center gap-1.5">
					<span className="h-2.5 w-[62%] rounded-sm bg-muted motion-safe:animate-pulse" />
					<span className="h-2 w-2/5 rounded-sm bg-muted motion-safe:animate-pulse" />
				</span>
			</div>
			{plainRows.map((width) => (
				<div className={cn(ROW_GRID, "@max-[400px]:hidden")} key={width}>
					<span className="size-5 justify-self-center rounded-[4.5px] bg-muted motion-safe:animate-pulse" />
					<span
						className={cn(
							"h-2.5 rounded-sm bg-muted motion-safe:animate-pulse",
							width,
						)}
					/>
				</div>
			))}
		</div>
	);
}

/**
 * A run is going: "Cline is working…" over the skeleton. After a send from
 * the tray the line leads with that suggestion's tile and ends in Undo ⌘3
 * while the host can still take the prompt back.
 */
export function SuggestionTrayWorking({
	suggestions,
	dispatch,
	view,
}: SuggestionTrayPartProps<ViewOf<"working"> | ViewOf<"sent">>) {
	const sent = view.mode === "sent" ? view : undefined;
	const sentItem = findSuggestionItem(
		suggestions.local,
		suggestions.local.sent?.itemId,
	);
	return (
		<>
			<div
				className={cn(sent?.canUndo ? ROW_GRID_WITH_END : ROW_GRID)}
				data-testid={sent ? "suggestion-sent" : "suggestion-working"}
			>
				{sent ? (
					<ToneTile
						icon={sentItem?.icon}
						label={sent.label}
						size="row"
						tone={sent.tone}
					/>
				) : (
					<span
						aria-hidden="true"
						className="size-1.5 justify-self-center rounded-full bg-primary motion-safe:animate-pulse"
					/>
				)}
				<output className="min-w-0 truncate text-muted-foreground">
					{sent ? <span className="sr-only">Sent {sent.label}. </span> : null}
					{WORKING_LINE}
				</output>
				{sent?.canUndo ? (
					<Button
						aria-keyshortcuts={suggestionVerbAriaKeys("undo")}
						className={TEXT_BUTTON_CLASSES}
						data-testid="suggestion-undo"
						onClick={() => dispatch("undo", "pointer")}
						size="xs"
						title={`${UNDO_TOOLTIP} (${suggestionVerbKbd("undo")})`}
						type="button"
						variant="ghost"
					>
						{UNDO_LABEL}
						<span aria-hidden="true" className="font-mono text-[10.5px]">
							{suggestionVerbKbd("undo")}
						</span>
					</Button>
				) : null}
			</div>
			<SuggestionTraySkeleton rows={3} />
		</>
	);
}

/** Use filled the message box: the suggestion's tile, whether it was edited, and Clear (Esc). */
export function SuggestionTrayUsed({
	suggestions,
	view,
	onClear,
}: SuggestionTrayPartProps<ViewOf<"used">> & { onClear: () => void }) {
	const item = findSuggestionItem(
		suggestions.local,
		suggestions.local.used?.itemId,
	);
	return (
		<div className={ROW_GRID_WITH_END} data-testid="suggestion-used">
			<ToneTile
				icon={item?.icon}
				label={view.label}
				size="row"
				tone={view.tone}
			/>
			<output className="min-w-0 truncate text-muted-foreground">
				{view.edited ? EDITED_LINE : USED_LINE}
			</output>
			<Button
				aria-keyshortcuts="Escape"
				className={TEXT_BUTTON_CLASSES}
				onClick={onClear}
				size="xs"
				title={CLEAR_TOOLTIP}
				type="button"
				variant="ghost"
			>
				{CLEAR_LABEL}
			</Button>
		</div>
	);
}

/** The person is typing their own message: the rows yield to one line, a dot per suggestion still waiting. */
export function SuggestionTrayYielded({
	view,
}: SuggestionTrayPartProps<ViewOf<"yielded">>) {
	return (
		<output
			className={cn(ROW_GRID, "text-muted-foreground")}
			data-testid="suggestion-yielded"
		>
			<span
				aria-hidden="true"
				className="flex items-center gap-[3px] justify-self-center"
			>
				{view.tones.map((tone, index) => (
					<span
						className={cn("size-1.5 rounded-[2px]", TONE_DOT_CLASSES[tone])}
						// biome-ignore lint/suspicious/noArrayIndexKey: one dot per waiting row, in row order
						key={index}
					/>
				))}
			</span>
			<span className="truncate">{YIELD_LINE(view.count)}</span>
		</output>
	);
}

/**
 * Nothing to show: an empty set, every likely one already offered, or no set
 * for this turn. Empty and Unavailable end in Try again, a new set, while the
 * plugin still offers one; Exhausted has no control.
 */
export function SuggestionTrayLine({
	suggestions,
	view,
}: SuggestionTrayPartProps<ViewOf<"line">>) {
	const retry = view.kind !== "exhausted";
	const canRefresh = suggestions.local.envelope?.state?.canRefresh === true;
	const text =
		view.kind === "empty"
			? EMPTY_LINE
			: view.kind === "exhausted"
				? EXHAUSTED_LINE
				: (view.note ?? UNAVAILABLE_LINE);
	return (
		<div
			className={cn(
				retry ? ROW_GRID_WITH_END : ROW_GRID,
				"text-muted-foreground",
			)}
			data-testid={`suggestion-${view.kind}`}
		>
			<MessageCircle
				aria-hidden="true"
				className="size-3.5 justify-self-center"
			/>
			<span className="truncate" title={text}>
				{text}
			</span>
			{retry ? (
				<Button
					className={TEXT_BUTTON_CLASSES}
					data-testid="suggestion-try-again"
					disabled={!canRefresh}
					onClick={() => suggestions.refresh("pointer")}
					size="xs"
					title={TRY_AGAIN_TOOLTIP}
					type="button"
					variant="ghost"
				>
					{TRY_AGAIN_LABEL}
				</Button>
			) : null}
		</div>
	);
}

/** Hide for this turn: the set stays out of the way until the next one. */
export function SuggestionTrayCollapsed({
	view,
}: SuggestionTrayPartProps<ViewOf<"collapsed">>) {
	return (
		<p
			className={cn(ROW_GRID, "text-muted-foreground")}
			data-testid="suggestion-collapsed"
		>
			<EyeOff aria-hidden="true" className="size-3.5 justify-self-center" />
			<span className="truncate">{COLLAPSED_LINE(view.count)}</span>
		</p>
	);
}

/** Hidden for this chat by the person (D15): one line that says so, and Show to bring it back. */
export function SuggestionTrayOff({
	suggestions,
	view,
}: SuggestionTrayPartProps<ViewOf<"off">>) {
	return (
		<div
			className={cn(ROW_GRID_WITH_END, "text-muted-foreground")}
			data-testid="suggestion-off"
		>
			<span
				aria-hidden="true"
				className="size-1.5 justify-self-center rounded-full bg-muted-foreground"
			/>
			<span className="truncate">{OFF_LINE(view.title)}</span>
			<Button
				className={TEXT_BUTTON_CLASSES}
				onClick={() => suggestions.show("pointer")}
				size="xs"
				title={SHOW_TOOLTIP}
				type="button"
				variant="ghost"
			>
				{SHOW_LABEL}
			</Button>
		</div>
	);
}
