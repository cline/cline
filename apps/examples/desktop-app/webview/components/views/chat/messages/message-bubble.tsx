"use client";

import { GeneratedMediaContent } from "@cline/ui";
import {
	Message as AgentMessage,
	type AgentMessageRole,
	MessageAction,
	MessageActions,
	MessageContent,
} from "@cline/ui/components/agent-chat";
import {
	Check,
	ChevronLeft,
	ChevronRight,
	Copy,
	Loader2,
	PencilIcon,
	SplitIcon,
	UndoIcon,
} from "lucide-react";
import { memo, useEffect, useState } from "react";
import type {
	ChatMessage,
	ChatMessageImage,
	ChatMessageMedia,
} from "@/lib/chat-schema";
import { cn } from "@/lib/utils";
import { MemoizedMarkdown } from "../../../ui/markdown";
import { formatChatMessageContent } from "../message-content";
import { ReasoningBlock } from "./reasoning-block";

function AssistantImageCarousel({
	images,
	onExpandImage,
}: {
	images: ChatMessageImage[];
	onExpandImage?: (image: ChatMessageImage) => void;
}) {
	const [activeIndex, setActiveIndex] = useState(0);
	const lastIndex = images.length - 1;
	const safeIndex = Math.min(activeIndex, lastIndex);
	const image = images[safeIndex];

	useEffect(() => {
		setActiveIndex((index) => Math.min(index, lastIndex));
	}, [lastIndex]);

	if (!image) return null;

	return (
		<div className="relative w-fit max-w-2xl">
			<button
				aria-label={`Expand generated image ${safeIndex + 1}`}
				className="cursor-zoom-in overflow-hidden rounded-lg border border-border bg-muted text-left transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				onClick={() => onExpandImage?.(image)}
				type="button"
			>
				{/* biome-ignore lint/performance/noImgElement: In-memory data URLs do not have dimensions and cannot use Next's optimizer. */}
				<img
					alt={`Generated result ${safeIndex + 1}`}
					className="max-h-56.25 max-w-56.25 object-contain"
					src={`data:${image.mediaType};base64,${image.data}`}
				/>
			</button>
			{images.length > 1 ? (
				<>
					<button
						aria-label="Previous generated image"
						className="absolute left-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background/85 text-foreground shadow-sm backdrop-blur-sm transition-opacity hover:bg-background disabled:cursor-not-allowed disabled:opacity-35"
						disabled={safeIndex === 0}
						onClick={() => setActiveIndex((index) => Math.max(0, index - 1))}
						type="button"
					>
						<ChevronLeft className="size-4" />
					</button>
					<button
						aria-label="Next generated image"
						className="absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background/85 text-foreground shadow-sm backdrop-blur-sm transition-opacity hover:bg-background disabled:cursor-not-allowed disabled:opacity-35"
						disabled={safeIndex === lastIndex}
						onClick={() =>
							setActiveIndex((index) => Math.min(lastIndex, index + 1))
						}
						type="button"
					>
						<ChevronRight className="size-4" />
					</button>
					<div className="absolute bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-background/85 px-2 py-0.5 text-[11px] text-foreground shadow-sm backdrop-blur-sm">
						{safeIndex + 1} / {images.length}
					</div>
				</>
			) : null}
		</div>
	);
}

function MessageImages({
	images,
	isUser,
	onExpandImage,
}: {
	images: ChatMessageImage[];
	isUser: boolean;
	onExpandImage?: (image: ChatMessageImage) => void;
}) {
	if (!isUser) {
		return (
			<AssistantImageCarousel images={images} onExpandImage={onExpandImage} />
		);
	}

	return (
		<div className="grid max-w-2xl gap-2">
			{images.map((image, index) => (
				<button
					aria-label={`Expand attachment ${index + 1}`}
					className="cursor-zoom-in overflow-hidden rounded-lg border border-border bg-muted text-left transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					key={image.id}
					onClick={() => onExpandImage?.(image)}
					type="button"
				>
					{/* biome-ignore lint/performance/noImgElement: In-memory data URLs do not have dimensions and cannot use Next's optimizer. */}
					<img
						alt={`Attachment ${index + 1}`}
						className="max-h-56.25 max-w-56.25 object-contain"
						src={`data:${image.mediaType};base64,${image.data}`}
					/>
				</button>
			))}
		</div>
	);
}

function MessageMedia({ media }: { media: ChatMessageMedia[] }) {
	return (
		<div className="flex max-w-2xl flex-col gap-2">
			{media.map((item) => (
				<GeneratedMediaContent
					classNames={{
						image:
							"max-h-96 max-w-full rounded-lg border border-border bg-muted object-contain",
						audio: "w-full",
						video: "max-h-96 max-w-full rounded-lg",
						file: "text-sm underline",
						unavailable: "rounded-lg border border-border bg-muted p-3 text-sm",
					}}
					key={item.id}
					media={item}
				/>
			))}
		</div>
	);
}

// Memoized with id-parameterized callbacks: during streaming only the message
// object that received a delta changes identity, so all other bubbles skip
// re-rendering (and re-running their Markdown pipeline) per flush.
export const MessageBubble = memo(function MessageBubble({
	agentRole,
	message,
	runCount,
	isStreaming = false,
	onCopyMessage,
	onExpandImage,
	onEditMessage,
	editDisabled = false,
	editPending = false,
	editError,
	onRestoreCheckpoint,
	restoreDisabled = false,
	restorePending = false,
	restoreError,
	wasCopied = false,
	onForkSession,
	forkDisabled = false,
	forkPending = false,
	forkError,
	isLastAssistantMessage = false,
	followsWorkingRows = false,
	reasoningContent,
	reasoningRedacted,
	thoughtDurationMilliseconds,
}: {
	agentRole: AgentMessageRole;
	message: ChatMessage;
	runCount?: number;
	isStreaming?: boolean;
	onCopyMessage?: (messageId: string, content: string) => void | Promise<void>;
	onExpandImage?: (image: ChatMessageImage) => void;
	onEditMessage?: (
		messageId: string,
		content: string,
		runCount: number,
	) => void | Promise<void>;
	editDisabled?: boolean;
	editPending?: boolean;
	editError?: string;
	onRestoreCheckpoint?: (
		messageId: string,
		runCount: number,
	) => void | Promise<void>;
	restoreDisabled?: boolean;
	restorePending?: boolean;
	restoreError?: string;
	wasCopied?: boolean;
	onForkSession?: (messageId: string) => void | Promise<void>;
	forkDisabled?: boolean;
	forkPending?: boolean;
	forkError?: string;
	isLastAssistantMessage?: boolean;
	/** Pulls the bubble closer to the working rows (tool calls/run summary)
	 * directly above it, which it answers. */
	followsWorkingRows?: boolean;
	reasoningContent: string;
	reasoningRedacted: boolean;
	thoughtDurationMilliseconds?: number;
}) {
	const isUser = message.role === "user";
	const isError = message.role === "error";
	const checkpoint = message.meta?.checkpoint;
	const displayContent = formatChatMessageContent(
		message.role,
		message.content,
	);
	const shouldRenderAssistantActions =
		message.role === "assistant" &&
		!isStreaming &&
		!isError &&
		Boolean(displayContent.trim()) &&
		Boolean(onCopyMessage || onForkSession);
	const shouldRenderUserActions =
		isUser &&
		Boolean(
			onCopyMessage ||
				checkpoint ||
				(onEditMessage && runCount && displayContent.trim()),
		);
	const keepUserActionsVisible =
		restorePending ||
		editPending ||
		Boolean(restoreError) ||
		Boolean(editError);
	const keepAssistantActionsVisible =
		isLastAssistantMessage || forkPending || Boolean(forkError);

	const messageDate = new Date(message.createdAt);
	const hasValidMessageDate = !Number.isNaN(messageDate.getTime());
	const messageTime = hasValidMessageDate
		? messageDate.toLocaleTimeString(undefined, {
				hour: "numeric",
				minute: "2-digit",
			})
		: null;
	const messageTimestamp = messageTime ? (
		<time
			className="shrink-0 whitespace-nowrap text-xs leading-none text-muted-foreground/70"
			dateTime={messageDate.toISOString()}
			title={messageDate.toLocaleString()}
		>
			{messageTime}
		</time>
	) : null;

	// Spacing between blocks comes from the conversation list's `gap-4` and
	// this content column's `gap-2`, with two exceptions: a user message opens
	// a new turn so it adds top margin, and an answer under its run's working
	// rows pulls itself closer to them.
	return (
		<AgentMessage
			className={cn(
				"relative flex flex-col gap-2",
				isUser && "mt-4 first:mt-0",
				followsWorkingRows && "-mt-2",
			)}
			from={agentRole}
		>
			<MessageContent className="flex min-w-0 flex-col gap-2 wrap-break-word">
				{reasoningContent || reasoningRedacted ? (
					<ReasoningBlock
						content={reasoningContent}
						durationMilliseconds={thoughtDurationMilliseconds}
						redacted={reasoningRedacted}
						streaming={isStreaming}
					/>
				) : null}

				{message.images?.length ? (
					<MessageImages
						images={message.images}
						isUser={isUser}
						onExpandImage={onExpandImage}
					/>
				) : null}

				{message.media?.length ? <MessageMedia media={message.media} /> : null}

				{displayContent ? (
					<div className="min-w-0 max-w-full wrap-break-word">
						<MemoizedMarkdown
							content={displayContent}
							streaming={isStreaming && message.role === "assistant"}
						/>
					</div>
				) : null}
			</MessageContent>

			{shouldRenderUserActions ? (
				<>
					<MessageActions side="end" visible={keepUserActionsVisible}>
						{onCopyMessage ? (
							<MessageAction
								label={wasCopied ? "Copied user message" : "Copy user message"}
								onClick={() => void onCopyMessage(message.id, message.content)}
								title={wasCopied ? "Copied" : "Copy message"}
							>
								{wasCopied ? (
									<Check className="h-3.5 w-3.5" />
								) : (
									<Copy className="h-3.5 w-3.5" />
								)}
							</MessageAction>
						) : null}
						{onEditMessage && runCount && displayContent.trim() ? (
							<MessageAction
								disabled={editDisabled || editPending}
								label="Edit user message"
								onClick={() =>
									void onEditMessage(message.id, displayContent, runCount)
								}
								title="Edit message and restart from this point"
							>
								{editPending ? (
									<Loader2 className="h-3.5 w-3.5 animate-spin" />
								) : (
									<PencilIcon className="h-3.5 w-3.5" />
								)}
							</MessageAction>
						) : null}
						{checkpoint ? (
							<MessageAction
								disabled={restoreDisabled || restorePending}
								label="Restore checkpoint"
								onClick={() =>
									void onRestoreCheckpoint?.(message.id, checkpoint.runCount)
								}
								title="Restore checkpoint"
							>
								{restorePending ? (
									<Loader2 className="h-3.5 w-3.5 animate-spin" />
								) : (
									<UndoIcon className="h-3.5 w-3.5" />
								)}
							</MessageAction>
						) : null}
						{messageTimestamp}
					</MessageActions>
					{restoreError ? (
						<div className="text-right text-xs text-destructive">
							{restoreError}
						</div>
					) : null}
					{editError ? (
						<div className="text-right text-xs text-destructive">
							{editError}
						</div>
					) : null}
				</>
			) : null}

			{shouldRenderAssistantActions ? (
				<MessageActions side="start" visible={keepAssistantActionsVisible}>
					{onCopyMessage ? (
						<MessageAction
							label={
								wasCopied
									? "Copied assistant message"
									: "Copy assistant message"
							}
							onClick={() => void onCopyMessage(message.id, message.content)}
							title={wasCopied ? "Copied" : "Copy raw assistant output"}
						>
							{wasCopied ? (
								<Check className="h-3 w-3" />
							) : (
								<Copy className="h-3 w-3" />
							)}
						</MessageAction>
					) : null}
					{onForkSession ? (
						<MessageAction
							disabled={forkDisabled || forkPending}
							label="Fork session"
							onClick={() => void onForkSession(message.id)}
							title="Fork session - copy full message history into a new session"
						>
							{forkPending ? (
								<Loader2 className="h-3 w-3 animate-spin" />
							) : (
								<SplitIcon className="h-3 w-3 rotate-90" />
							)}
						</MessageAction>
					) : null}
					{messageTimestamp}
					{forkError ? (
						<span className="text-[11px] text-destructive">{forkError}</span>
					) : null}
				</MessageActions>
			) : null}
		</AgentMessage>
	);
});
