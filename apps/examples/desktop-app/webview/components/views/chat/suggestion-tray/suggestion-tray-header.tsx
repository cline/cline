"use client";

import type { SuggestionsView } from "@cline/shared/browser";
import { MoreHorizontal, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import {
	shiftKeyLabel,
	suggestionVerbAriaKeys,
	suggestionVerbKbd,
} from "./suggestion-tray-keycaps";
import {
	REFRESH_LABEL,
	type SuggestionTrayPartProps,
} from "./suggestion-tray-shared";
import { TONE_DOT_CLASSES } from "./suggestion-tray-tones";

/** The views that draw the header: a set, one loading, a line in its place, or one hidden for the turn. */
export type HeaderView = Extract<
	SuggestionsView,
	{ mode: "ready" | "loading" | "line" | "collapsed" }
>;

const HIDE_LABEL = "Hide suggestions for this chat";
const COLLAPSE_LABEL = "Hide for this turn";
const UNDO_SKIP_LABEL = "Undo skip";
const MORE_LABEL = "More suggestion options";
const MORE_TOOLTIP = "More";
const SHORTCUTS_LABEL = "Keyboard shortcuts";
const PLACE_LABEL = (index: number, count: number) =>
	`${index + 1} of ${count}`;
const PLACE_TOOLTIP = "Press ↑ or ↓ to see the others";

/** The header's icon buttons: 20 px square, a muted 13 px glyph, the hover surface from the ghost variant. */
const ICON_BUTTON_CLASSES = "size-5 rounded-[5.5px] p-0 text-muted-foreground";
const ICON_CLASSES = "size-[13px]";

/** The More menu's shortcuts legend, one line per verb, in the platform's keycaps. */
function shortcutLines(): { label: string; keys: string }[] {
	return [
		{
			label: "Put the highlighted suggestion in the message box",
			keys: suggestionVerbKbd("use"),
		},
		{ label: "Send it now", keys: suggestionVerbKbd("send") },
		{ label: "Skip it", keys: suggestionVerbKbd("skip") },
		{ label: "Suggest a new set", keys: suggestionVerbKbd("refresh") },
		{ label: "Take back a sent suggestion", keys: suggestionVerbKbd("undo") },
		{ label: "Choose a suggestion (not while typing)", keys: "↑ ↓" },
		{
			label: "From the list: use it, or send it",
			keys: `Enter · ${shiftKeyLabel()}Enter`,
		},
		{ label: "Clear a used suggestion, or hide the list", keys: "Esc" },
	];
}

function cueDotClass(view: HeaderView): string {
	if (view.mode === "loading") return "bg-primary motion-safe:animate-pulse";
	if (view.mode !== "line" && view.cue) return TONE_DOT_CLASSES[view.cue.tone];
	return "bg-muted-foreground";
}

/** The tray's accessible name: the header as it reads, "Next · after a command failed". */
export function headerLabel(view: HeaderView): string {
	return view.mode !== "line" && view.cue
		? `${view.title} · ${view.cue.text}`
		: view.title;
}

/**
 * The tray's 20 px header: a cue dot in the cue's tone (pulsing while a set
 * computes), the title and the cue, the "n of m" place pill in a compact
 * tray, ↻ for a new set (on a set, or in place of an empty one), and the More
 * menu with New set, Undo skip, Hide for this turn, the shortcuts and Hide
 * for this chat.
 */
export function SuggestionTrayHeader({
	suggestions,
	dispatch,
	view,
}: SuggestionTrayPartProps<HeaderView>) {
	const canRefresh =
		view.mode === "ready"
			? view.canRefresh
			: suggestions.local.envelope?.state?.canRefresh === true;
	const showRefresh =
		view.mode === "ready" || (view.mode === "line" && view.kind === "empty");
	const showPlace =
		view.mode === "ready" &&
		view.density === "compact" &&
		view.position.count > 1;
	const cue = view.mode !== "line" ? view.cue : undefined;
	const refresh = () => {
		if (view.mode === "ready") dispatch("refresh", "pointer");
		else suggestions.refresh("pointer");
	};

	return (
		<header className="flex h-5 items-center gap-1.5 pl-[7px]">
			<span
				aria-hidden="true"
				className={cn("size-1.5 shrink-0 rounded-full", cueDotClass(view))}
			/>
			<span
				className="flex min-w-0 flex-1 items-center gap-1.5"
				data-testid="suggestion-header"
			>
				<span className="shrink-0 text-xs font-medium text-foreground">
					{view.title}
				</span>
				{cue ? (
					<span className="min-w-0 truncate text-muted-foreground">
						· {cue.text}
					</span>
				) : null}
			</span>
			{showPlace ? (
				<span
					className="inline-flex h-4 shrink-0 items-center rounded-[4.5px] bg-muted px-[5px] text-[11px] font-medium text-muted-foreground"
					data-testid="suggestion-place"
					title={PLACE_TOOLTIP}
				>
					{PLACE_LABEL(view.position.index, view.position.count)}
				</span>
			) : null}
			<div className="flex shrink-0 items-center gap-1.5">
				{showRefresh ? (
					<Button
						aria-keyshortcuts={suggestionVerbAriaKeys("refresh")}
						aria-label={REFRESH_LABEL}
						className={ICON_BUTTON_CLASSES}
						disabled={!canRefresh}
						onClick={refresh}
						size="icon-sm"
						title={`${REFRESH_LABEL} (${suggestionVerbKbd("refresh")})`}
						type="button"
						variant="ghost"
					>
						<RefreshCw aria-hidden="true" className={ICON_CLASSES} />
					</Button>
				) : null}
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							aria-label={MORE_LABEL}
							className={ICON_BUTTON_CLASSES}
							data-testid="suggestion-more"
							size="icon-sm"
							title={MORE_TOOLTIP}
							type="button"
							variant="ghost"
						>
							<MoreHorizontal aria-hidden="true" className={ICON_CLASSES} />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="w-64 text-xs">
						<DropdownMenuItem
							className="text-xs"
							disabled={!canRefresh}
							onSelect={refresh}
						>
							{REFRESH_LABEL}
							<DropdownMenuShortcut>
								{suggestionVerbKbd("refresh")}
							</DropdownMenuShortcut>
						</DropdownMenuItem>
						<DropdownMenuItem
							className="text-xs"
							disabled={!suggestions.canUnskip}
							onSelect={() => suggestions.unskip("pointer")}
						>
							{UNDO_SKIP_LABEL}
						</DropdownMenuItem>
						<DropdownMenuItem
							className="text-xs"
							disabled={view.mode !== "ready"}
							onSelect={() => suggestions.collapse("pointer")}
						>
							{COLLAPSE_LABEL}
							<DropdownMenuShortcut>Esc</DropdownMenuShortcut>
						</DropdownMenuItem>
						<DropdownMenuSub>
							<DropdownMenuSubTrigger className="text-xs">
								{SHORTCUTS_LABEL}
							</DropdownMenuSubTrigger>
							<DropdownMenuSubContent className="w-80 text-xs">
								{shortcutLines().map((line) => (
									<DropdownMenuLabel
										className="flex items-center justify-between gap-3 text-xs font-normal"
										key={line.label}
									>
										<span>{line.label}</span>
										<Kbd className="shrink-0 font-mono text-[10px]">
											{line.keys}
										</Kbd>
									</DropdownMenuLabel>
								))}
							</DropdownMenuSubContent>
						</DropdownMenuSub>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							className="text-xs"
							onSelect={() => suggestions.hideForChat("pointer")}
						>
							{HIDE_LABEL}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</header>
	);
}
