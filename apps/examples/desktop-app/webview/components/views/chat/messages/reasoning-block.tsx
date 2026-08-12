"use client";

import {
	Reasoning,
	ReasoningContent,
	ReasoningTrigger,
} from "@cline/ui/components/agent-chat";
import { BrainIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { MemoizedMarkdown } from "../../../ui/markdown";
import { EXPANDED_PANEL_RAIL_CLASS, STREAMING_TITLE_CLASS } from "./constants";
import { formatThoughtLabel } from "./group-messages";

export function ReasoningBlock({
	content,
	durationMilliseconds,
	redacted,
	streaming = false,
}: {
	content: string;
	durationMilliseconds?: number;
	redacted: boolean;
	streaming?: boolean;
}) {
	const displayContent = content || (redacted ? "[redacted]" : "");
	const label = streaming
		? "Thinking"
		: formatThoughtLabel(durationMilliseconds);
	if (!displayContent) {
		return null;
	}

	return (
		<Reasoning className="my-0" isStreaming={streaming}>
			<ReasoningTrigger
				aria-label={label}
				className="gap-2 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
			>
				<BrainIcon aria-hidden="true" className="h-4 w-4 shrink-0" />
				<span className={cn("font-medium", streaming && STREAMING_TITLE_CLASS)}>
					{label}
				</span>
			</ReasoningTrigger>
			<ReasoningContent
				className={cn(
					EXPANDED_PANEL_RAIL_CLASS,
					// Prose reflows, so the X axis is pinned shut: `overflow-y-auto`
					// alone would compute overflow-x to `auto` and let a long
					// unbreakable token add a horizontal scrollbar.
					"max-h-48 overflow-x-hidden overflow-y-auto",
					"text-sm leading-relaxed text-muted-foreground",
				)}
			>
				<MemoizedMarkdown
					classNames="text-sm font-thin"
					content={displayContent}
					streaming={streaming}
				/>
			</ReasoningContent>
		</Reasoning>
	);
}
