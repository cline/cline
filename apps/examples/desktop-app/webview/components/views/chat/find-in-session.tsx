"use client";

import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatMatchCount } from "@/lib/session-search";

type FindInSessionProps = {
	query: string;
	onQueryChange: (query: string) => void;
	activeMatchIndex: number;
	totalMatches: number;
	onStepMatch: (direction: "next" | "previous") => void;
	onClose: () => void;
};

/**
 * Search bar for the open session. Purely presentational: matching, stepping
 * and wraparound all live in lib/session-search, so this component only owns
 * focus, keyboard handling and layout.
 */
export function FindInSession({
	query,
	onQueryChange,
	activeMatchIndex,
	totalMatches,
	onStepMatch,
	onClose,
}: FindInSessionProps) {
	const inputId = useId();
	const inputRef = useRef<HTMLInputElement>(null);

	// Focus on mount so Cmd+F lands the caret in the field, and select any
	// preserved query so typing replaces it the way native find bars behave.
	useEffect(() => {
		inputRef.current?.focus();
		inputRef.current?.select();
	}, []);

	const hasMatches = totalMatches > 0;
	const countLabel = formatMatchCount(activeMatchIndex, totalMatches, query);

	return (
		/* <search> carries the implicit search landmark role natively. */
		<search
			aria-label="Find in session"
			className="absolute right-6 top-4 z-30 flex items-center gap-2 rounded-lg border border-border/70 bg-background/95 p-1.5 shadow-md backdrop-blur-[2px]"
		>
			<label className="sr-only" htmlFor={inputId}>
				Find in session
			</label>
			<Input
				aria-describedby={`${inputId}-count`}
				className="h-7 w-56 text-sm"
				id={inputId}
				onChange={(event) => onQueryChange(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						event.preventDefault();
						onClose();
						return;
					}
					if (event.key === "Enter") {
						event.preventDefault();
						onStepMatch(event.shiftKey ? "previous" : "next");
					}
				}}
				placeholder="Find in session"
				ref={inputRef}
				type="search"
				value={query}
			/>
			{/* Polite so stepping through matches is announced without
			    interrupting whatever the screen reader is already saying. */}
			<output
				aria-live="polite"
				className="min-w-16 shrink-0 text-center text-xs tabular-nums text-muted-foreground"
				id={`${inputId}-count`}
			>
				{countLabel}
			</output>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						aria-label="Previous match"
						disabled={!hasMatches}
						onClick={() => onStepMatch("previous")}
						size="icon-sm"
						type="button"
						variant="ghost"
					>
						<ChevronUp />
					</Button>
				</TooltipTrigger>
				<TooltipContent>
					Previous match <Kbd>⇧⏎</Kbd>
				</TooltipContent>
			</Tooltip>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						aria-label="Next match"
						disabled={!hasMatches}
						onClick={() => onStepMatch("next")}
						size="icon-sm"
						type="button"
						variant="ghost"
					>
						<ChevronDown />
					</Button>
				</TooltipTrigger>
				<TooltipContent>
					Next match <Kbd>⏎</Kbd>
				</TooltipContent>
			</Tooltip>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						aria-label="Close find bar"
						onClick={onClose}
						size="icon-sm"
						type="button"
						variant="ghost"
					>
						<X />
					</Button>
				</TooltipTrigger>
				<TooltipContent>
					Close <Kbd>Esc</Kbd>
				</TooltipContent>
			</Tooltip>
		</search>
	);
}
