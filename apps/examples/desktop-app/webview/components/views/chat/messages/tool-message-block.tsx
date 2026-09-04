"use client";

import { GeneratedMediaContent } from "@cline/ui";
import {
	ToolActivity,
	ToolActivityCode,
	ToolActivityContent,
	ToolActivityDetails,
	ToolActivityTrigger,
} from "@cline/ui/components/agent-chat";
import { ToolFileDiff } from "@cline/ui/components/agent-chat/tool-diff";
import type { ToolLabelPart } from "@cline/ui/components/agent-chat/tool-summary";
import Ansi from "ansi-to-react";
import { AlertCircle, Loader2 } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	type ChatMessage,
	type ChatMessageImage,
	ChatMessageImageSchema,
} from "@/lib/chat-schema";
import { appendCappedCommandOutput } from "@/lib/command-output";
import { cn } from "@/lib/utils";
import { MemoizedMarkdown } from "../../../ui/markdown";
import { IS_DEBUG, STREAMING_TITLE_CLASS } from "./constants";
import { MessageImageCarousel } from "./image-carousel";
import { getToolNameIcon } from "./tool-icons";
import {
	buildToolPresentation,
	extractRunCommandOutput,
	extractSubmitSummaryText,
	formatToolValue,
} from "./tool-summaries";

type ProceedWhileRunningHandler = (
	sessionId: string,
	toolCallId?: string,
) => void | Promise<void>;

function ToolLabel({
	parts,
	isRunning,
}: {
	parts: ToolLabelPart[];
	isRunning: boolean;
}) {
	return (
		<span className={cn(isRunning && STREAMING_TITLE_CLASS)}>
			{parts.map((part, index) =>
				part.code ? (
					<span className="font-mono" key={`${index}_${part.text}`}>
						{part.text}
					</span>
				) : (
					<span key={`${index}_${part.text}`}>{part.text}</span>
				),
			)}
		</span>
	);
}

const ToolCallRow = memo(function ToolCallRow({
	message,
	onExpandImage,
	onProceedWhileRunning,
}: {
	message: ChatMessage;
	onExpandImage?: (image: ChatMessageImage) => void;
	onProceedWhileRunning?: ProceedWhileRunningHandler;
}) {
	const { payload, toolName, inProgress, summary } =
		buildToolPresentation(message);
	const isCommand = summary.kind === "command";
	// submit_and_exit carries the run's final answer (scheduled tasks end with
	// it), so surface it expanded and rendered as markdown rather than leaving
	// it collapsed behind a code block.
	const isSubmit = summary.toolName === "submit_and_exit";
	const submitText = isSubmit
		? extractSubmitSummaryText(payload) || summary.outputText || ""
		: "";
	// The generic fallback label ("Submit and exit") describes the tool, not
	// the moment; name the milestone the row represents instead.
	const labelParts = isSubmit
		? [
				{
					text: inProgress
						? "Completing scheduled task"
						: payload?.isError
							? "Scheduled task failed"
							: "Scheduled task completed",
				},
			]
		: summary.labelParts;
	const commandOutputSource = isCommand
		? message.meta?.toolOutput ||
			(payload?.isError
				? ""
				: extractRunCommandOutput(payload?.result) || summary.outputText || "")
		: "";
	const commandOutput = commandOutputSource
		? appendCappedCommandOutput("", commandOutputSource).output
		: "";
	const toolSessionId = message.sessionId;
	const toolCallId = message.meta?.toolCallId;
	const canProceed = Boolean(
		inProgress &&
			isCommand &&
			message.meta?.toolDetachable === true &&
			toolSessionId &&
			onProceedWhileRunning,
	);
	const fileDiffs = summary.items.flatMap((item, index) => {
		if (item.type !== "file") return [];
		const hunks =
			item.hunks ??
			(item.newText !== undefined
				? [{ oldText: item.oldText, newText: item.newText }]
				: null);
		if (hunks) {
			return hunks.map((hunk, hunkIndex) => ({
				key: `${message.id}_diff_${index}_${hunkIndex}`,
				kind: "rich" as const,
				item,
				hunk,
			}));
		}
		return item.diff
			? [
					{
						key: `${message.id}_diff_${index}`,
						kind: "text" as const,
						item,
						hunk: null,
					},
				]
			: [];
	});
	const hasFileDiffs = fileDiffs.length > 0;
	const outputImages = summary.outputMedia.flatMap((media, index) => {
		if (media.modality !== "image") return [];
		const image = ChatMessageImageSchema.safeParse({
			id: `${message.id}_tool_image_${index}`,
			mediaType: media.mediaType,
			data: media.data,
		});
		return image.success ? [image.data] : [];
	});
	const otherOutputMedia = summary.outputMedia.filter(
		(media) => media.modality !== "image",
	);
	const shouldAutoOpen =
		hasFileDiffs ||
		Boolean(submitText) ||
		summary.outputMedia.length > 0 ||
		(inProgress && (Boolean(commandOutput) || canProceed));
	const [open, setOpen] = useState(shouldAutoOpen);
	const [userToggled, setUserToggled] = useState(false);
	const [isProceeding, setIsProceeding] = useState(false);
	const [proceedError, setProceedError] = useState<string | null>(null);
	useEffect(() => {
		if (shouldAutoOpen && !userToggled) setOpen(true);
	}, [shouldAutoOpen, userToggled]);
	const handleOpenChange = useCallback((nextOpen: boolean) => {
		setUserToggled(true);
		setOpen(nextOpen);
	}, []);
	const handleProceedWhileRunning = useCallback(async () => {
		if (!onProceedWhileRunning || !toolSessionId || isProceeding) return;
		setIsProceeding(true);
		setProceedError(null);
		try {
			await Promise.resolve(onProceedWhileRunning(toolSessionId, toolCallId));
		} catch (error) {
			setProceedError(
				error instanceof Error
					? error.message
					: "Could not detach the running command.",
			);
		} finally {
			setIsProceeding(false);
		}
	}, [isProceeding, onProceedWhileRunning, toolCallId, toolSessionId]);

	const backgroundStatus = message.meta?.toolBackgroundStatus;
	const hasError = Boolean(
		payload?.isError ||
			backgroundStatus === "failed" ||
			backgroundStatus === "killed",
	);
	const Icon = getToolNameIcon(toolName);
	const details = summary.details.map((detail, index) => ({
		detail,
		key: `${message.id}_${index}`,
	}));
	const inputPreview =
		IS_DEBUG && payload ? formatToolValue(payload.input) : "";
	const hasExpandedSections =
		details.length > 0 ||
		fileDiffs.length > 0 ||
		Boolean(submitText) ||
		Boolean(isCommand ? commandOutput : summary.outputText) ||
		summary.outputMedia.length > 0 ||
		Boolean(summary.errorText) ||
		Boolean(inputPreview) ||
		canProceed;

	return (
		<ToolActivity
			className="my-0"
			expandable={hasExpandedSections}
			onOpenChange={handleOpenChange}
			open={open}
		>
			<ToolActivityTrigger
				additions={summary.diff?.additions || undefined}
				deletions={summary.diff?.deletions || undefined}
				icon={
					hasError ? (
						<AlertCircle className="size-4 text-destructive/80" />
					) : (
						<Icon className="size-4" />
					)
				}
				label={<ToolLabel isRunning={inProgress} parts={labelParts} />}
				showDisclosureIcon={false}
				status={hasError ? "error" : inProgress ? "running" : "success"}
			/>
			<ToolActivityContent presentation="rail">
				{details.length > 0 ? (
					<ToolActivityDetails
						className={cn(
							"whitespace-pre-wrap",
							isCommand && "font-mono text-xs",
						)}
					>
						{details.map(({ detail, key }) => (
							<div key={key}>{isCommand ? `$ ${detail}` : detail}</div>
						))}
					</ToolActivityDetails>
				) : null}
				{fileDiffs.map((entry) =>
					entry.kind === "rich" && entry.hunk ? (
						<ToolFileDiff
							className="mt-1"
							fragment={entry.item.fragment}
							key={entry.key}
							newText={entry.hunk.newText}
							oldText={entry.hunk.oldText}
							path={entry.item.path}
						/>
					) : (
						<ToolActivityCode
							className="mt-1 overflow-x-auto text-xs"
							key={entry.key}
						>
							{entry.item.diff}
						</ToolActivityCode>
					),
				)}
				{commandOutput ? (
					<CommandOutputTerminal
						isRunning={inProgress}
						output={commandOutput}
					/>
				) : submitText ? (
					// The summary is the run's final answer: full foreground color,
					// not the panel's muted tool-detail gray.
					<div className="mt-1 min-w-0 max-w-full wrap-break-word text-foreground">
						<MemoizedMarkdown content={submitText} />
					</div>
				) : summary.outputText ? (
					<ToolActivityCode className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">
						{summary.outputText}
					</ToolActivityCode>
				) : null}
				{outputImages.length > 0 ? (
					<div className="mt-2">
						<MessageImageCarousel
							images={outputImages}
							onExpandImage={onExpandImage}
						/>
					</div>
				) : null}
				{otherOutputMedia.length > 0 ? (
					<div className="mt-2 flex max-w-2xl flex-col gap-2">
						{otherOutputMedia.map((media, index) => (
							<GeneratedMediaContent
								classNames={{
									audio: "w-full",
									video: "max-h-96 max-w-full rounded-lg",
									file: "text-sm underline",
									unavailable:
										"rounded-lg border border-border bg-muted p-3 text-sm",
								}}
								key={`${message.id}_tool_media_${index}`}
								media={{
									id: `${message.id}_tool_media_${index}`,
									modality: media.modality,
									mediaType: media.mediaType,
									name: media.name,
									source: { type: "base64", data: media.data },
								}}
							/>
						))}
					</div>
				) : null}
				{inputPreview ? (
					<div className="space-y-1">
						<div className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
							Input
						</div>
						<ToolActivityCode className="text-sm">
							{inputPreview}
						</ToolActivityCode>
					</div>
				) : null}
				{summary.errorText ? (
					<div className="mt-1 break-words text-destructive">
						{summary.errorText}
					</div>
				) : null}
				{canProceed ? (
					<div className="mt-2 space-y-1.5">
						<Button
							disabled={isProceeding}
							onClick={() => void handleProceedWhileRunning()}
							size="sm"
							type="button"
							variant="outline"
						>
							{isProceeding ? (
								<Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
							) : null}
							Proceed while running
						</Button>
						{proceedError ? (
							<div className="text-xs text-destructive">{proceedError}</div>
						) : null}
					</div>
				) : null}
			</ToolActivityContent>
		</ToolActivity>
	);
});

function CommandOutputTerminal({
	output,
	isRunning,
}: {
	output: string;
	isRunning: boolean;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const shouldAutoScrollRef = useRef(true);
	useEffect(() => {
		const container = containerRef.current;
		if (container && shouldAutoScrollRef.current) {
			container.scrollTop = output ? container.scrollHeight : 0;
		}
	}, [output]);

	return (
		<div className="mt-2 space-y-1">
			<div className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
				Output
			</div>
			<div
				aria-label="Command output"
				aria-live="off"
				className="max-h-64 overflow-auto rounded-md border border-border/70 bg-black/90 p-3 font-mono text-xs leading-relaxed text-zinc-100"
				onScroll={(event) => {
					const container = event.currentTarget;
					shouldAutoScrollRef.current =
						container.scrollHeight -
							container.scrollTop -
							container.clientHeight <
						24;
				}}
				ref={containerRef}
				role="log"
			>
				<pre className="whitespace-pre-wrap break-words">
					<Ansi>{output}</Ansi>
					{isRunning ? (
						<span
							aria-hidden="true"
							className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-zinc-100"
						/>
					) : null}
				</pre>
			</div>
		</div>
	);
}

export const ToolMessageBlock = memo(
	function ToolMessageBlock({
		messages,
		onExpandImage,
		onProceedWhileRunning,
	}: {
		messages: ChatMessage[];
		onExpandImage?: (image: ChatMessageImage) => void;
		onProceedWhileRunning?: ProceedWhileRunningHandler;
	}) {
		if (messages.length === 0) return null;
		return (
			<div className="flex flex-col gap-1">
				{messages.map((message) => (
					<ToolCallRow
						key={message.id}
						message={message}
						onExpandImage={onExpandImage}
						onProceedWhileRunning={onProceedWhileRunning}
					/>
				))}
			</div>
		);
	},
	(prev, next) =>
		prev.messages.length === next.messages.length &&
		prev.messages.every((message, index) => message === next.messages[index]) &&
		prev.onExpandImage === next.onExpandImage &&
		prev.onProceedWhileRunning === next.onProceedWhileRunning,
);
