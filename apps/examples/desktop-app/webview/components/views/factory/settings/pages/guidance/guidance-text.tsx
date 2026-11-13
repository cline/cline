"use client";

import { FS_GUIDANCE } from "@/lib/factory-settings-copy/guidance";
import { cn } from "@/lib/utils";
import type { DiffLine } from "./line-diff";

const HEADING = /^#{1,6}\s+/;

/**
 * Guidance as it reads: headings bold, paragraphs spaced, nothing in
 * monospace. With `lines`, changed lines are marked (removed struck through,
 * added tinted) and named "added" / "removed" for screen readers.
 */
export function GuidanceText({
	text,
	lines,
	className,
}: {
	text?: string;
	lines?: readonly DiffLine[];
	className?: string;
}) {
	const shown: readonly DiffLine[] =
		lines ??
		(text ?? "")
			.replace(/\r\n/g, "\n")
			.split("\n")
			.map((line) => ({ kind: "same" as const, text: line }));
	return (
		<div
			data-guidance-text=""
			className={cn(
				"cline-chat-selectable text-[13px] leading-[19px] break-words whitespace-pre-wrap",
				className,
			)}
		>
			{shown.map((line, index) => {
				const heading = HEADING.test(line.text);
				const content = heading ? line.text.replace(HEADING, "") : line.text;
				return (
					<p
						// biome-ignore lint/suspicious/noArrayIndexKey: lines have no identity beyond their position.
						key={index}
						data-line={line.kind}
						className={cn(
							"-mx-3.5 px-3.5",
							heading && "font-semibold text-foreground",
							heading && index > 0 && "mt-1",
							!content.trim() && "h-3",
							line.kind === "removed" &&
								"bg-destructive/15 text-muted-foreground line-through",
							line.kind === "added" && "bg-emerald-500/15",
						)}
					>
						{line.kind === "same" ? null : (
							<span className="sr-only">
								{`${line.kind === "added" ? FS_GUIDANCE.added : FS_GUIDANCE.removed}: `}
							</span>
						)}
						{content}
					</p>
				);
			})}
		</div>
	);
}
