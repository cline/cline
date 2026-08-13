"use client";

import {
	Message as AgentMessage,
	type AgentMessageRole,
	MessageAction,
	MessageActions,
	MessageContent,
} from "@cline/ui/components/agent-chat";
import {
	Check,
	Copy,
	Loader2,
	PencilIcon,
	Square,
	SplitIcon,
	UndoIcon,
	Volume2,
} from "lucide-react";
import { memo } from "react";
import type {
	ChatMessage,
	ChatMessageImage,
	ChatMessageVideo,
} from "@/lib/chat-schema";
import { MemoizedMarkdown } from "../../../ui/markdown";
import { formatChatMessageContent } from "../message-content";
import { MessageAudios, MessageImages, MessageVideos } from "./message-media";
import { ReasoningBlock } from "./reasoning-block";

export type AssistantSpeechPhase = "generating" | "playing";

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
	onExpandVideo,
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
	onSpeakMessage,
	speechAvailable = false,
	speechSettingsLoaded = false,
	speechState,
	speechTargetLabel,
	isLastAssistantMessage = false,
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
	onExpandVideo?: (video: ChatMessageVideo) => void;
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
	onSpeakMessage?: (messageId: string, content: string) => void | Promise<void>;
	speechAvailable?: boolean;
	speechSettingsLoaded?: boolean;
	speechState?: AssistantSpeechPhase;
	speechTargetLabel?: string;
	isLastAssistantMessage?: boolean;
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
		Boolean(onCopyMessage || onForkSession || onSpeakMessage);
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
		isLastAssistantMessage ||
		forkPending ||
		Boolean(forkError) ||
		Boolean(speechState);

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

	// Spacing between blocks comes solely from the conversation list's `gap-8`
	// and this content column's `gap-2`; blocks must not add their own margins.
	return (
		<AgentMessage className="relative flex flex-col gap-2" from={agentRole}>
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

				{message.videos?.length && message.sessionId ? (
					<MessageVideos
						onExpandVideo={onExpandVideo}
						sessionId={message.sessionId}
						videos={message.videos}
					/>
				) : null}

				{message.audios?.length && message.sessionId ? (
					<MessageAudios
						audios={message.audios}
						sessionId={message.sessionId}
					/>
				) : null}

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
					{onSpeakMessage ? (
						<MessageAction
							disabled={!speechSettingsLoaded}
							label={
								speechState === "generating"
									? "Cancel speech generation"
									: speechState === "playing"
										? "Stop speaking assistant message"
										: speechAvailable
											? "Speak assistant message"
											: "Configure voice output"
							}
							onClick={() => void onSpeakMessage(message.id, displayContent)}
							title={
								!speechSettingsLoaded
									? "Loading voice output settings"
									: speechState === "generating"
										? "Cancel speech generation"
										: speechState === "playing"
											? "Stop speaking"
											: speechTargetLabel
												? `Speak with ${speechTargetLabel}`
												: "Configure voice output in Settings → Models"
							}
						>
							{speechState ? (
								<Square
									className={
										speechState === "generating"
											? "size-3 animate-pulse"
											: "size-3"
									}
								/>
							) : (
								<Volume2 className="size-3" />
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
