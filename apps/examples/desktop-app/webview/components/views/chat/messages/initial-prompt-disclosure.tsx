"use client";

import { ChevronRight } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Folds the prompt that opened a watch-only transcript (e.g. the engine's
 * task instructions to a Factory role agent) behind a disclosure row styled
 * like the transcript's other disclosure triggers. Closed by default.
 */
export function InitialPromptDisclosure({
	showLabel,
	hideLabel,
	children,
}: {
	showLabel: string;
	hideLabel: string;
	children: ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const contentId = useId();
	return (
		<div className="flex min-w-0 flex-col gap-2" data-initial-prompt="">
			<button
				aria-controls={contentId}
				aria-expanded={open}
				className="cline-chat-work-trigger"
				onClick={() => setOpen((value) => !value)}
				type="button"
			>
				<ChevronRight
					aria-hidden
					className={cn(
						"size-3.5 shrink-0 transition-transform motion-reduce:transition-none",
						open && "rotate-90",
					)}
				/>
				<span className="min-w-0">{open ? hideLabel : showLabel}</span>
			</button>
			<div hidden={!open} id={contentId}>
				{open ? children : null}
			</div>
		</div>
	);
}
