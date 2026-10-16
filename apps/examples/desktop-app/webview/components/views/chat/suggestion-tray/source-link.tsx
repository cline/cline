"use client";

import type {
	ComposerSuggestionItem,
	SuggestionSourcePlacement,
} from "@cline/shared/browser";
import { ExternalLink } from "lucide-react";
import type { MouseEvent } from "react";
import { openExternalUrl } from "@/lib/desktop-client";
import { cn } from "@/lib/utils";

const LINK_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * A link a row may open: an absolute http(s) URL; anything else reads as
 * none, so nothing else leaves for the browser.
 */
function asHttpUrl(value: unknown): string | null {
	if (typeof value !== "string" || !value.trim()) return null;
	try {
		return LINK_PROTOCOLS.has(new URL(value.trim()).protocol)
			? value.trim()
			: null;
	} catch {
		return null;
	}
}

/** A source link: 18 px, 11 px medium muted words underlined at 45 %, the accent surface on hover. */
const LINK_CLASSES = [
	"inline-flex h-[18px] shrink-0 cursor-pointer items-center gap-[3px] rounded-sm px-1 text-[11px] font-medium text-muted-foreground underline decoration-muted-foreground/45 underline-offset-2",
	"hover:bg-accent hover:text-accent-foreground hover:no-underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
];

/** A plain source: where the suggestion came from, with nowhere to go. */
const LABEL_CLASSES =
	"inline-flex h-[18px] max-w-32 min-w-0 shrink-0 items-center px-1 text-[11px] font-medium text-muted-foreground";

function keepRowDoubleClick(event: MouseEvent) {
	event.stopPropagation();
}

/**
 * A row's source at its end: a link opened in the browser through the host
 * when it has an http(s) url, else its label as plain words. `placement`
 * comes from the view: `icon` keeps only the link's glyph (its words stay its
 * accessible name), and `in-detail` or `none` draw nothing here.
 */
export function SourceLink({
	item,
	placement,
	className,
}: {
	item: ComposerSuggestionItem;
	placement: SuggestionSourcePlacement;
	className?: string;
}) {
	const source = item.source;
	if (!source || (placement !== "inline" && placement !== "icon")) return null;
	const url = asHttpUrl(source.url);
	if (!url) {
		return (
			<span
				className={cn(LABEL_CLASSES, className)}
				data-testid="suggestion-source"
			>
				<span className="truncate">{source.label}</span>
			</span>
		);
	}
	const open = (event: MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
		void openExternalUrl(url);
	};
	const iconOnly = placement === "icon";
	return (
		<a
			aria-label={iconOnly ? source.label : undefined}
			className={cn(LINK_CLASSES, iconOnly && "px-[3px]", className)}
			data-testid="suggestion-source"
			href={url}
			onAuxClick={(event) => {
				if (event.button === 1) open(event);
			}}
			onClick={open}
			onDoubleClick={keepRowDoubleClick}
			rel="noopener noreferrer"
			target="_blank"
			title={`Open ${source.label} in your browser`}
		>
			{iconOnly ? null : (
				<span className="max-w-32 min-w-0 truncate">{source.label}</span>
			)}
			<ExternalLink
				aria-hidden="true"
				className={cn("shrink-0", iconOnly ? "size-3" : "size-[11px]")}
			/>
		</a>
	);
}
