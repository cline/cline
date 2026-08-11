"use client";

import {
	ToolActivity,
	ToolActivityCode,
	ToolActivityContent,
	ToolActivityDetails,
	ToolActivityTrigger,
} from "@cline/ui/components/agent-chat";
import { AlertCircle, WrenchIcon } from "lucide-react";
import { memo } from "react";
import type { ChatMessage } from "@/lib/chat-schema";
import { cn } from "@/lib/utils";
import {
	EXPANDED_PANEL_RAIL_CLASS,
	IS_DEBUG,
	STREAMING_TITLE_CLASS,
} from "./constants";
import { getToolNameIcon } from "./tool-icons";
import {
	buildGroupedToolLabel,
	buildToolPresentation,
	formatToolValue,
} from "./tool-summaries";

// Memoized with element-wise comparison: the grouping pass wraps the same
// message objects in fresh arrays every commit, so reference-comparing the
// contents lets finished tool blocks skip re-rendering during streaming.
export const ToolMessageBlock = memo(
	function ToolMessageBlock({ messages }: { messages: ChatMessage[] }) {
		const presentations = messages.map(buildToolPresentation);
		if (presentations.length === 0) return null;
		const hasError = presentations.some(({ payload }) => payload?.isError);
		const isRunning = presentations.some(({ inProgress }) => inProgress);
		const label = buildGroupedToolLabel(presentations);
		const icons = presentations.map(({ toolName }) =>
			getToolNameIcon(toolName),
		);
		const firstIcon = icons[0] ?? WrenchIcon;
		const Icon = icons.every((icon) => icon === firstIcon)
			? firstIcon
			: WrenchIcon;
		const details = presentations.flatMap(({ message, summary }) =>
			summary.details.map((detail) => ({
				detail,
				key: `${message.id}_${detail}`,
			})),
		);
		const inputPreviews = IS_DEBUG
			? presentations
					.map(({ message, payload, toolName }) => ({
						key: message.id,
						toolName,
						value: payload ? formatToolValue(payload.input) : "",
					}))
					.filter(({ value }) => Boolean(value))
			: [];
		const resultPreviews = presentations
			.map(({ message, payload, toolName }) => ({
				key: message.id,
				toolName,
				value: payload?.isError ? formatToolValue(payload.result) : "",
			}))
			.filter(({ value }) => Boolean(value));
		const hasExpandedSections =
			details.length > 0 ||
			inputPreviews.length > 0 ||
			resultPreviews.length > 0;
		const diff = presentations.reduce(
			(total, { summary }) => ({
				additions: total.additions + (summary.diff?.additions ?? 0),
				deletions: total.deletions + (summary.diff?.deletions ?? 0),
			}),
			{ additions: 0, deletions: 0 },
		);

		return (
			<ToolActivity className="my-0" expandable={hasExpandedSections}>
				<ToolActivityTrigger
					additions={diff.additions || undefined}
					deletions={diff.deletions || undefined}
					icon={
						hasError ? (
							<AlertCircle className="size-4 text-destructive/80" />
						) : (
							<Icon className="size-4" />
						)
					}
					label={
						<span className={cn(isRunning && STREAMING_TITLE_CLASS)}>
							{label}
						</span>
					}
					showDisclosureIcon={false}
					status={hasError ? "error" : isRunning ? "running" : "success"}
				/>
				<ToolActivityContent className={EXPANDED_PANEL_RAIL_CLASS}>
					{details.length > 0 ? (
						<ToolActivityDetails className="whitespace-pre-wrap">
							{details.map(({ detail, key }) => (
								<div key={key}>{detail}</div>
							))}
						</ToolActivityDetails>
					) : null}
					{inputPreviews.map((preview) => (
						<div className="space-y-1" key={`input_${preview.key}`}>
							<div className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
								{presentations.length > 1
									? `${preview.toolName} input`
									: "Input"}
							</div>
							<ToolActivityCode className="text-sm">
								{preview.value}
							</ToolActivityCode>
						</div>
					))}
					{resultPreviews.map((preview) => (
						<div
							className="mt-1 break-words text-destructive"
							key={`result_${preview.key}`}
						>
							{presentations.length > 1 ? `${preview.toolName}: ` : null}
							{preview.value}
						</div>
					))}
				</ToolActivityContent>
			</ToolActivity>
		);
	},
	(prev, next) =>
		prev.messages.length === next.messages.length &&
		prev.messages.every((message, index) => message === next.messages[index]),
);
