"use client";

import {
	Message as AgentMessage,
	Conversation,
	ConversationContent,
	ConversationScrollButton,
	ConversationViewport,
	MessageAction,
	MessageActions,
	MessageContent,
	Reasoning,
	ReasoningContent,
	ReasoningTrigger,
	ToolActivity,
	ToolActivityCode,
	ToolActivityContent,
	ToolActivityDetails,
	ToolActivityTrigger,
} from "@cline/ui/components/agent-chat";
import {
	AlertCircle,
	Bot,
	Check,
	Clock3,
	Copy,
	FileEdit,
	FileIcon,
	FileSearch,
	Loader2,
	MessagesSquare,
	Search,
	ShieldAlert,
	SplitIcon,
	SquareTerminalIcon,
	UndoIcon,
	X,
} from "lucide-react";
import { memo, useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import type {
	ChatMessage,
	ChatMessageImage,
	ChatSessionStatus,
} from "@/lib/chat-schema";
import { parseApplyPatchInput } from "@/lib/session-diff";
import { cn } from "@/lib/utils";
import { MemoizedMarkdown } from "../../ui/markdown";
import { formatChatMessageContent } from "./message-content";

type ChatMessagesProps = {
	sessionId: string | null;
	status: ChatSessionStatus;
	chatTransportState?:
		| "connecting"
		| "reconnecting"
		| "connected"
		| "unavailable";
	isSessionSwitching?: boolean;
	messages: ChatMessage[];
	error: string | null;
	streamingMessageId?: string | null;
	pendingToolApprovals: ToolApprovalRequestItem[];
	pendingAskQuestions: AskQuestionRequestItem[];
	onApproveToolApproval: (requestId: string) => void | Promise<void>;
	onRejectToolApproval: (requestId: string) => void | Promise<void>;
	onAnswerAskQuestion: (
		requestId: string,
		answer: string,
	) => void | Promise<void>;
	onRestoreCheckpoint?: (runCount: number) => void | Promise<void>;
	onForkSession?: () => void | Promise<void>;
};

type ToolApprovalRequestItem = {
	requestId: string;
	sessionId: string;
	createdAt: string;
	toolCallId: string;
	toolName: string;
	input?: unknown;
	iteration?: number;
	agentId?: string;
	conversationId?: string;
};

type AskQuestionRequestItem = {
	requestId: string;
	createdAt: string;
	question: string;
	options: string[];
	context?: {
		agentId?: string;
		conversationId?: string;
		iteration?: number;
	};
};

type ChatRenderItem =
	| { type: "message"; message: ChatMessage }
	| { type: "tools"; messages: ChatMessage[] };

function groupConsecutiveToolMessages(
	messages: ChatMessage[],
): ChatRenderItem[] {
	const items: ChatRenderItem[] = [];
	for (const message of messages) {
		const previous = items.at(-1);
		if (message.role === "tool") {
			if (previous?.type === "tools") {
				previous.messages.push(message);
			} else {
				items.push({ type: "tools", messages: [message] });
			}
			continue;
		}
		items.push({ type: "message", message });
	}
	return items;
}

const IS_DEBUG = process.env.NODE_ENV === "test";

function ChatMessagesImpl({
	sessionId,
	status,
	chatTransportState = "connecting",
	isSessionSwitching = false,
	messages,
	error,
	streamingMessageId = null,
	pendingToolApprovals,
	pendingAskQuestions,
	onApproveToolApproval,
	onRejectToolApproval,
	onAnswerAskQuestion,
	onRestoreCheckpoint,
	onForkSession,
}: ChatMessagesProps) {
	const hasMessages = messages.length > 0;
	const lastErrorMessage = [...messages]
		.reverse()
		.find((message) => message.role === "error");
	const shouldShowErrorBanner =
		Boolean(error) && (!lastErrorMessage || lastErrorMessage.content !== error);
	// Core reports "running" as soon as the turn is dispatched, well before the
	// first streamed chunk arrives, so keep the thinking indicator up until the
	// model produces output (or something else needs the user's attention).
	const lastConversationMessage = [...messages]
		.reverse()
		.find((message) => message.role !== "status");
	const isAwaitingFirstOutput =
		status === "running" &&
		!streamingMessageId &&
		lastConversationMessage?.role === "user" &&
		pendingToolApprovals.length === 0 &&
		pendingAskQuestions.length === 0;
	const [showSwitchTransition, setShowSwitchTransition] = useState(false);
	const [toolApprovalActions, setToolApprovalActions] = useState<
		Record<string, "approving" | "rejecting">
	>({});
	const [toolApprovalErrors, setToolApprovalErrors] = useState<
		Record<string, string>
	>({});
	const [askQuestionActions, setAskQuestionActions] = useState<
		Record<string, string>
	>({});
	const [askQuestionErrors, setAskQuestionErrors] = useState<
		Record<string, string>
	>({});
	const [checkpointActions, setCheckpointActions] = useState<
		Record<string, "undoing">
	>({});
	const [checkpointErrors, setCheckpointErrors] = useState<
		Record<string, string>
	>({});
	const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
	const [forkingMessageId, setForkingMessageId] = useState<string | null>(null);
	const [forkErrors, setForkErrors] = useState<Record<string, string>>({});
	const [expandedImage, setExpandedImage] = useState<{
		sessionId: string | null;
		image: ChatMessageImage;
	} | null>(null);
	const visibleExpandedImage =
		expandedImage?.sessionId === sessionId ? expandedImage.image : null;
	const showIdleDetails =
		!hasMessages && !isSessionSwitching && !showSwitchTransition;

	useEffect(() => {
		if (!visibleExpandedImage) {
			return;
		}
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setExpandedImage(null);
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [visibleExpandedImage]);

	useEffect(() => {
		if (!isSessionSwitching) {
			setShowSwitchTransition((prev) => (prev ? false : prev));
			return;
		}
		const timer = window.setTimeout(() => {
			setShowSwitchTransition((prev) => (prev ? prev : true));
		}, 180);
		return () => {
			window.clearTimeout(timer);
		};
	}, [isSessionSwitching]);

	useEffect(() => {
		const activeRequestIds = new Set(
			pendingToolApprovals.map((item) => item.requestId),
		);
		setToolApprovalActions((prev) => pruneRequestMap(prev, activeRequestIds));
		setToolApprovalErrors((prev) => pruneRequestMap(prev, activeRequestIds));
	}, [pendingToolApprovals]);

	useEffect(() => {
		const activeRequestIds = new Set(
			pendingAskQuestions.map((item) => item.requestId),
		);
		setAskQuestionActions((prev) => pruneRequestMap(prev, activeRequestIds));
		setAskQuestionErrors((prev) => pruneRequestMap(prev, activeRequestIds));
	}, [pendingAskQuestions]);

	const handleToolApprovalDecision = useCallback(
		async (
			requestId: string,
			action: "approving" | "rejecting",
			fn: (requestId: string) => void | Promise<void>,
		) => {
			setToolApprovalActions((prev) => ({ ...prev, [requestId]: action }));
			setToolApprovalErrors((prev) => {
				if (!prev[requestId]) {
					return prev;
				}
				const next = { ...prev };
				delete next[requestId];
				return next;
			});
			try {
				await Promise.resolve(fn(requestId));
			} catch (err) {
				const message =
					err instanceof Error ? err.message : "Could not submit decision.";
				setToolApprovalErrors((prev) => ({ ...prev, [requestId]: message }));
			} finally {
				setToolApprovalActions((prev) => {
					if (!prev[requestId]) {
						return prev;
					}
					const next = { ...prev };
					delete next[requestId];
					return next;
				});
			}
		},
		[],
	);

	const handleAskQuestionAnswer = useCallback(
		async (requestId: string, answer: string) => {
			setAskQuestionActions((prev) => ({ ...prev, [requestId]: answer }));
			setAskQuestionErrors((prev) => {
				if (!prev[requestId]) return prev;
				const next = { ...prev };
				delete next[requestId];
				return next;
			});
			try {
				await Promise.resolve(onAnswerAskQuestion(requestId, answer));
			} catch (err) {
				const message =
					err instanceof Error ? err.message : "Could not submit answer.";
				setAskQuestionErrors((prev) => ({ ...prev, [requestId]: message }));
			} finally {
				setAskQuestionActions((prev) => {
					if (!prev[requestId]) return prev;
					const next = { ...prev };
					delete next[requestId];
					return next;
				});
			}
		},
		[onAnswerAskQuestion],
	);

	const handleCopyMessage = useCallback(
		async (messageId: string, text: string) => {
			try {
				await navigator.clipboard.writeText(text);
				setCopiedMessageId(messageId);
				window.setTimeout(() => {
					setCopiedMessageId((current) =>
						current === messageId ? null : current,
					);
				}, 1600);
			} catch {
				toast({
					variant: "destructive",
					title: "Copy failed",
					description: "The message could not be copied to the clipboard.",
				});
			}
		},
		[],
	);

	const handleRestoreCheckpoint = useCallback(
		async (messageId: string, runCount: number) => {
			if (!onRestoreCheckpoint) {
				return;
			}
			setCheckpointActions((prev) => ({ ...prev, [messageId]: "undoing" }));
			setCheckpointErrors((prev) => {
				if (!prev[messageId]) {
					return prev;
				}
				const next = { ...prev };
				delete next[messageId];
				return next;
			});
			try {
				await Promise.resolve(onRestoreCheckpoint(runCount));
			} catch (err) {
				const message =
					err instanceof Error ? err.message : "Could not restore checkpoint.";
				setCheckpointErrors((prev) => ({ ...prev, [messageId]: message }));
			} finally {
				setCheckpointActions((prev) => {
					if (!prev[messageId]) {
						return prev;
					}
					const next = { ...prev };
					delete next[messageId];
					return next;
				});
			}
		},
		[onRestoreCheckpoint],
	);

	const handleForkSession = useCallback(
		async (messageId: string) => {
			if (!onForkSession) {
				return;
			}
			setForkingMessageId(messageId);
			setForkErrors((prev) => {
				if (!prev[messageId]) {
					return prev;
				}
				const next = { ...prev };
				delete next[messageId];
				return next;
			});
			try {
				await Promise.resolve(onForkSession());
			} catch (err) {
				const message =
					err instanceof Error ? err.message : "Could not fork session.";
				setForkErrors((prev) => ({ ...prev, [messageId]: message }));
			} finally {
				setForkingMessageId((current) =>
					current === messageId ? null : current,
				);
			}
		},
		[onForkSession],
	);

	return (
		<Conversation
			className="relative isolate h-full min-h-0 min-w-0 overflow-hidden"
			key={sessionId ?? "new-chat"}
		>
			<ConversationViewport
				aria-label="Agent conversation"
				className="h-full min-h-0 min-w-0"
			>
				<ConversationContent
					className={cn(
						"relative mx-auto min-h-full w-full min-w-0 max-w-full overflow-x-hidden",
						showIdleDetails ? "p-0" : "px-6 py-6",
					)}
				>
					{showIdleDetails ? null : (
						<div className="flex min-h-full w-full min-w-0 flex-col gap-2 overflow-x-hidden">
							{pendingToolApprovals.length > 0 ? (
								<ToolApprovalPanel
									items={pendingToolApprovals}
									onApprove={(requestId) =>
										handleToolApprovalDecision(
											requestId,
											"approving",
											onApproveToolApproval,
										)
									}
									onReject={(requestId) =>
										handleToolApprovalDecision(
											requestId,
											"rejecting",
											onRejectToolApproval,
										)
									}
									pendingActions={toolApprovalActions}
									requestErrors={toolApprovalErrors}
								/>
							) : null}
							{pendingAskQuestions.length > 0 ? (
								<AskQuestionPanel
									items={pendingAskQuestions}
									onAnswer={(requestId, answer) =>
										handleAskQuestionAnswer(requestId, answer)
									}
									pendingActions={askQuestionActions}
									requestErrors={askQuestionErrors}
								/>
							) : null}
							{groupConsecutiveToolMessages(messages).map((item) => {
								if (item.type === "tools") {
									return (
										<ToolMessageBlock
											key={`tools_${item.messages[0]?.id ?? "empty"}`}
											messages={item.messages}
										/>
									);
								}
								const { message } = item;
								return (
									<MessageBubble
										isStreaming={streamingMessageId === message.id}
										key={message.id}
										message={message}
										onExpandImage={(image) =>
											setExpandedImage({ sessionId, image })
										}
										onCopyRawText={() =>
											void handleCopyMessage(message.id, message.content)
										}
										onRestoreCheckpoint={(runCount) =>
											void handleRestoreCheckpoint(message.id, runCount)
										}
										restoreDisabled={
											!onRestoreCheckpoint ||
											status === "starting" ||
											status === "running" ||
											status === "stopping" ||
											isSessionSwitching
										}
										restoreError={checkpointErrors[message.id]}
										restorePending={checkpointActions[message.id] === "undoing"}
										wasCopied={copiedMessageId === message.id}
										onForkSession={
											onForkSession
												? () => void handleForkSession(message.id)
												: undefined
										}
										forkPending={forkingMessageId === message.id}
										forkError={forkErrors[message.id]}
									/>
								);
							})}
						</div>
					)}
					{showSwitchTransition ? (
						hasMessages ? (
							<div className="pointer-events-none absolute right-6 top-6 z-20 rounded-full border border-border/70 bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur-[1px]">
								<div className="flex items-center gap-1.5">
									<Loader2 className="h-3.5 w-3.5 animate-spin" />
									Switching session...
								</div>
							</div>
						) : (
							<div className="rounded-xl border border-border/70 bg-card p-4">
								<div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
									<Loader2 className="h-4 w-4 animate-spin" />
									Loading session...
								</div>
								<div className="space-y-3">
									<div className="h-4 w-2/5 animate-pulse rounded bg-muted/70" />
									<div className="h-4 w-4/5 animate-pulse rounded bg-muted/70" />
									<div className="h-4 w-3/5 animate-pulse rounded bg-muted/70" />
								</div>
							</div>
						)
					) : null}
					{(status === "starting" || isAwaitingFirstOutput) &&
					!isSessionSwitching ? (
						<div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
							<Loader2 className="h-4 w-4 animate-spin" />
							Thinking...
						</div>
					) : null}
					{chatTransportState !== "connected" && !shouldShowErrorBanner ? (
						<div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
							{chatTransportState === "reconnecting"
								? "Reconnecting chat..."
								: chatTransportState === "unavailable"
									? "Chat backend unavailable"
									: "Connecting chat..."}
						</div>
					) : null}
					{shouldShowErrorBanner ? (
						<div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
							{error}
						</div>
					) : null}
				</ConversationContent>
			</ConversationViewport>
			<ConversationScrollButton />
			{visibleExpandedImage ? (
				<div
					aria-label="Expanded attachment"
					aria-modal="true"
					className="absolute inset-0 z-50 flex items-center justify-center bg-background/95 p-4 backdrop-blur-sm"
					role="dialog"
				>
					<button
						aria-label="Close expanded attachment"
						className="absolute inset-0 cursor-zoom-out"
						onClick={() => setExpandedImage(null)}
						type="button"
					/>
					<div className="pointer-events-none relative z-10 flex h-full w-full items-center justify-center">
						{/* biome-ignore lint/performance/noImgElement: User-provided data URLs cannot use Next's optimizer. */}
						<img
							alt="Expanded attachment"
							className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
							src={`data:${visibleExpandedImage.mediaType};base64,${visibleExpandedImage.data}`}
						/>
						<Button
							aria-label="Close image viewer"
							className="pointer-events-auto absolute right-0 top-0 rounded-full"
							onClick={() => setExpandedImage(null)}
							size="icon"
							type="button"
							variant="secondary"
						>
							<X className="h-4 w-4" />
						</Button>
					</div>
				</div>
			) : null}
		</Conversation>
	);
}

export const ChatMessages = memo(ChatMessagesImpl);

function formatApprovalTimestamp(raw: string): string {
	const parsed = new Date(raw);
	if (Number.isNaN(parsed.getTime())) {
		return "Pending now";
	}
	return parsed.toLocaleString();
}

function formatApprovalInput(input: unknown): string {
	if (input == null) {
		return "{}";
	}
	if (typeof input === "string") {
		return input;
	}
	try {
		return JSON.stringify(input, null, 2);
	} catch {
		return String(input);
	}
}

function ToolApprovalPanel({
	items,
	pendingActions,
	requestErrors,
	onApprove,
	onReject,
}: {
	items: ToolApprovalRequestItem[];
	pendingActions: Record<string, "approving" | "rejecting">;
	requestErrors: Record<string, string>;
	onApprove: (requestId: string) => void;
	onReject: (requestId: string) => void;
}) {
	return (
		<section className="rounded-xl border border-amber-400/40 bg-amber-500/5 p-3">
			<div className="flex items-center gap-2 text-sm font-medium text-foreground">
				<ShieldAlert className="h-4 w-4 text-amber-500" />
				Tool approval required
			</div>
			<p className="mt-1 text-xs text-muted-foreground">
				Review each tool call and approve or reject it before execution.
			</p>
			<div className="mt-3 flex flex-col gap-2">
				{items.map((item) => {
					const pendingAction = pendingActions[item.requestId];
					const isPending = Boolean(pendingAction);
					const error = requestErrors[item.requestId];
					return (
						<div
							className="rounded-lg border border-border/80 bg-background/70 p-3"
							key={item.requestId}
						>
							<div className="flex items-center justify-between gap-2">
								<div className="text-sm font-medium text-foreground">
									{item.toolName}
								</div>
								<div className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
									<Clock3 className="h-3 w-3" />
									{formatApprovalTimestamp(item.createdAt)}
								</div>
							</div>
							<div className="mt-1 text-[11px] text-muted-foreground">
								Request {item.requestId}
								{item.iteration != null ? ` · Iteration ${item.iteration}` : ""}
							</div>
							<pre className="mt-2 max-h-44 max-w-full overflow-x-hidden overflow-y-auto whitespace-pre-wrap wrap-break-word rounded-md border border-border/70 bg-background p-2 text-xs text-muted-foreground">
								{formatApprovalInput(item.input)}
							</pre>
							{error ? (
								<div className="mt-2 text-xs text-destructive">{error}</div>
							) : null}
							<div className="mt-2 flex items-center gap-2">
								<Button
									disabled={isPending}
									onClick={() => onApprove(item.requestId)}
									size="sm"
									type="button"
									variant="default"
								>
									{pendingAction === "approving" ? (
										<>
											<Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
											Approving...
										</>
									) : (
										"Approve"
									)}
								</Button>
								<Button
									disabled={isPending}
									onClick={() => onReject(item.requestId)}
									size="sm"
									type="button"
									variant="outline"
								>
									{pendingAction === "rejecting" ? (
										<>
											<Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
											Rejecting...
										</>
									) : (
										"Reject"
									)}
								</Button>
							</div>
						</div>
					);
				})}
			</div>
		</section>
	);
}

function AskQuestionPanel({
	items,
	pendingActions,
	requestErrors,
	onAnswer,
}: {
	items: AskQuestionRequestItem[];
	pendingActions: Record<string, string>;
	requestErrors: Record<string, string>;
	onAnswer: (requestId: string, answer: string) => void;
}) {
	return (
		<section className="rounded-xl border border-blue-400/40 bg-blue-500/5 p-3">
			<div className="flex items-center gap-2 text-sm font-medium text-foreground">
				<MessagesSquare className="h-4 w-4 text-blue-500" />
				Follow-up question
			</div>
			<p className="mt-1 text-xs text-muted-foreground">
				Choose one option to continue the current agent turn.
			</p>
			<div className="mt-3 flex flex-col gap-2">
				{items.map((item) => {
					const pendingAnswer = pendingActions[item.requestId];
					const isPending = Boolean(pendingAnswer);
					const error = requestErrors[item.requestId];
					return (
						<div
							className="rounded-lg border border-border/80 bg-background/70 p-3"
							key={item.requestId}
						>
							<div className="flex items-center justify-between gap-2">
								<div className="text-sm font-medium text-foreground">
									{item.question}
								</div>
								<div className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
									<Clock3 className="h-3 w-3" />
									{formatApprovalTimestamp(item.createdAt)}
								</div>
							</div>
							<div className="mt-1 text-[11px] text-muted-foreground">
								Request {item.requestId}
								{item.context?.iteration != null
									? ` · Iteration ${item.context.iteration}`
									: ""}
							</div>
							{error ? (
								<div className="mt-2 text-xs text-destructive">{error}</div>
							) : null}
							<div className="mt-3 flex flex-wrap items-center gap-2">
								{item.options.map((option) => (
									<Button
										disabled={isPending}
										key={option}
										onClick={() => onAnswer(item.requestId, option)}
										size="sm"
										type="button"
										variant="outline"
									>
										{pendingAnswer === option ? (
											<>
												<Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
												Sending...
											</>
										) : (
											option
										)}
									</Button>
								))}
							</div>
						</div>
					);
				})}
			</div>
		</section>
	);
}

function MessageBubble({
	message,
	isStreaming = false,
	onCopyRawText,
	onExpandImage,
	onRestoreCheckpoint,
	restoreDisabled = false,
	restorePending = false,
	restoreError,
	wasCopied = false,
	onForkSession,
	forkPending = false,
	forkError,
}: {
	message: ChatMessage;
	isStreaming?: boolean;
	onCopyRawText?: () => void;
	onExpandImage?: (image: ChatMessageImage) => void;
	onRestoreCheckpoint?: (runCount: number) => void;
	restoreDisabled?: boolean;
	restorePending?: boolean;
	restoreError?: string;
	wasCopied?: boolean;
	onForkSession?: () => void;
	forkPending?: boolean;
	forkError?: string;
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
		Boolean(onCopyRawText || onForkSession);
	const shouldRenderUserActions =
		isUser && Boolean(onCopyRawText || checkpoint);
	const keepUserActionsVisible = restorePending || Boolean(restoreError);
	const keepAssistantActionsVisible = forkPending || Boolean(forkError);

	const reasoningContent = message.reasoning?.trim() || "";

	return (
		<AgentMessage from={message.role}>
			<MessageContent className="space-y-2 wrap-break-word">
				{reasoningContent || message.reasoningRedacted ? (
					<ReasoningBlock
						content={reasoningContent}
						redacted={message.reasoningRedacted === true}
						streaming={isStreaming}
					/>
				) : null}

				{message.images?.length ? (
					<div className="grid max-w-2xl gap-2">
						{message.images.map((image, index) => (
							<button
								aria-label={`Expand attachment ${index + 1}`}
								className="cursor-zoom-in overflow-hidden rounded-lg border border-border bg-muted text-left transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								key={image.id}
								onClick={() => onExpandImage?.(image)}
								type="button"
							>
								{/* biome-ignore lint/performance/noImgElement: User-provided data URLs do not have dimensions and cannot use Next's optimizer. */}
								<img
									alt={`Attachment ${index + 1}`}
									className="max-h-[28rem] max-w-full object-contain"
									src={`data:${image.mediaType};base64,${image.data}`}
								/>
							</button>
						))}
					</div>
				) : null}

				{displayContent ? (
					<div className="my-1 min-w-0 max-w-full wrap-break-word">
						<MemoizedMarkdown
							content={displayContent}
							streaming={isStreaming && message.role === "assistant"}
						/>
					</div>
				) : null}
			</MessageContent>

			{shouldRenderUserActions ? (
				<>
					<MessageActions visible={keepUserActionsVisible}>
						{onCopyRawText ? (
							<MessageAction
								label={wasCopied ? "Copied user message" : "Copy user message"}
								onClick={onCopyRawText}
								title={wasCopied ? "Copied" : "Copy message"}
							>
								{wasCopied ? (
									<Check className="h-3.5 w-3.5" />
								) : (
									<Copy className="h-3.5 w-3.5" />
								)}
							</MessageAction>
						) : null}
						{checkpoint ? (
							<MessageAction
								disabled={restoreDisabled || restorePending}
								label="Restore checkpoint"
								onClick={() => onRestoreCheckpoint?.(checkpoint.runCount)}
								title="Restore checkpoint"
							>
								{restorePending ? (
									<Loader2 className="h-3.5 w-3.5 animate-spin" />
								) : (
									<UndoIcon className="h-3.5 w-3.5" />
								)}
							</MessageAction>
						) : null}
					</MessageActions>
					{restoreError ? (
						<div className="text-right text-xs text-destructive">
							{restoreError}
						</div>
					) : null}
				</>
			) : null}

			{shouldRenderAssistantActions ? (
				<MessageActions visible={keepAssistantActionsVisible}>
					{onCopyRawText ? (
						<MessageAction
							label={
								wasCopied
									? "Copied assistant message"
									: "Copy assistant message"
							}
							onClick={onCopyRawText}
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
							disabled={forkPending}
							label="Fork session"
							onClick={onForkSession}
							title="Fork session - copy full message history into a new session"
						>
							{forkPending ? (
								<Loader2 className="h-3 w-3 animate-spin" />
							) : (
								<SplitIcon className="h-3 w-3" />
							)}
						</MessageAction>
					) : null}
					{forkError ? (
						<span className="text-[11px] text-destructive">{forkError}</span>
					) : null}
				</MessageActions>
			) : null}
		</AgentMessage>
	);
}

function ReasoningBlock({
	content,
	redacted,
	streaming = false,
}: {
	content: string;
	redacted: boolean;
	streaming?: boolean;
}) {
	const displayContent = content || (redacted ? "[redacted]" : "");
	if (!displayContent) {
		return null;
	}

	return (
		<Reasoning isStreaming={streaming}>
			<ReasoningTrigger />
			<ReasoningContent>
				<MemoizedMarkdown content={displayContent} streaming={streaming} />
			</ReasoningContent>
		</Reasoning>
	);
}

type ToolPayload = {
	toolName?: string;
	input?: unknown;
	result?: unknown;
	isError?: boolean;
};

type ToolSummary = {
	label: string;
	details: string[];
	aggregate?: {
		key: string;
		count: number;
		noun: string;
		completedVerb: string;
		progressVerb: string;
	};
	diff?: {
		additions: number;
		deletions: number;
	};
};

function pruneRequestMap<T extends string>(
	prev: Record<string, T>,
	activeRequestIds: Set<string>,
): Record<string, T> {
	let hasRemoved = false;
	const next: Record<string, T> = {};
	for (const [requestId, value] of Object.entries(prev)) {
		if (activeRequestIds.has(requestId)) {
			next[requestId] = value;
			continue;
		}
		hasRemoved = true;
	}
	return hasRemoved ? next : prev;
}

function parseJsonString(value: string): unknown {
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return value;
	}
}

function normalizeDisplayValue(value: unknown): unknown {
	if (typeof value !== "string") {
		return value;
	}
	const trimmed = value.trim();
	if (
		(trimmed.startsWith("{") && trimmed.endsWith("}")) ||
		(trimmed.startsWith("[") && trimmed.endsWith("]"))
	) {
		return parseJsonString(trimmed);
	}
	return value;
}

function formatToolValue(value: unknown): string {
	const normalized = normalizeDisplayValue(value);
	if (normalized == null) {
		return "";
	}
	if (typeof normalized === "string") {
		return normalized;
	}
	if (
		typeof normalized === "object" &&
		"error" in normalized &&
		typeof normalized.error === "string"
	) {
		return normalized.error;
	}
	try {
		return JSON.stringify(normalized, null, 2);
	} catch {
		return String(normalized);
	}
}

function parseToolPayload(raw: string): ToolPayload | null {
	try {
		return JSON.parse(raw) as ToolPayload;
	} catch {
		return null;
	}
}

function classifyTool(
	toolName: string,
): "exploration" | "file-edit" | "bash" | "spawn" | "tool" {
	const normalized = toolName.toLowerCase();
	if (
		[
			"search",
			"search_codebase",
			"file-read",
			"file_read",
			"read_files",
			"web-fetch",
			"web_fetch",
			"fetch_web_content",
			"skills",
		].includes(normalized)
	)
		return "exploration";
	if (
		["editor", "edit_file", "edit", "apply_patch", "apply-patch"].includes(
			normalized,
		)
	)
		return "file-edit";
	if (["bash", "run_commands"].includes(normalized)) return "bash";
	if (
		["spawn_agent", "spawn-agent", "spawn_agent_tool"].includes(normalized) ||
		normalized.startsWith("subagent_")
	)
		return "spawn";
	return "tool";
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter(
		(item): item is string => typeof item === "string" && item.length > 0,
	);
}

/**
 * read_files accepts many input shapes: { files: [{ path }] }, { files: path },
 * { file_paths: [...] }, { paths: [...] }, a bare request, an array, or a string.
 */
function extractReadFilePaths(input: unknown): string[] {
	const out: string[] = [];
	const push = (value: unknown) => {
		if (typeof value === "string" && value.length > 0) {
			out.push(value);
			return;
		}
		const record = asRecord(value);
		if (record && typeof record.path === "string" && record.path.length > 0) {
			out.push(record.path);
		}
	};
	const record = asRecord(input);
	const candidates =
		record?.files ?? record?.file_paths ?? record?.paths ?? record ?? input;
	if (Array.isArray(candidates)) {
		for (const candidate of candidates) {
			push(candidate);
		}
	} else {
		push(candidates);
	}
	return out;
}

/**
 * run_commands entries can be shell strings or structured { command, args }.
 */
function extractCommands(input: unknown): string[] {
	const inputObject = asRecord(input);
	const raw = Array.isArray(inputObject?.commands)
		? inputObject.commands
		: typeof inputObject?.command === "string"
			? [inputObject.command]
			: typeof input === "string"
				? [input]
				: [];
	const out: string[] = [];
	for (const entry of raw) {
		if (typeof entry === "string" && entry.length > 0) {
			out.push(entry);
			continue;
		}
		const record = asRecord(entry);
		if (record && typeof record.command === "string") {
			const args = asStringArray(record.args);
			out.push([record.command, ...args].join(" "));
		}
	}
	return out;
}

function toDisplayPath(path: string): string {
	const parts = path.split(/[\\/]/);
	return parts.at(-1) || path;
}

function parseDiffCounts(
	value: unknown,
): { additions: number; deletions: number } | null {
	if (typeof value !== "string") return null;
	const lines = value.split("\n");
	let additions = 0;
	let deletions = 0;

	for (const line of lines) {
		if (/^\+\d+:/.test(line)) additions += 1;
		if (/^-\d+:/.test(line)) deletions += 1;
	}

	if (additions === 0 && deletions === 0) return null;
	return { additions, deletions };
}

function pluralize(
	count: number,
	singular: string,
	plural = `${singular}s`,
): string {
	return `${count} ${count === 1 ? singular : plural}`;
}

function buildToolSummary(
	toolName: string,
	input: unknown,
	result: unknown,
	inProgress: boolean,
): ToolSummary {
	const normalized = toolName.toLowerCase();
	const inputObject = asRecord(input);

	if (["read_files", "file_read", "file-read"].includes(normalized)) {
		const files = extractReadFilePaths(input);
		if (files.length > 0) {
			return {
				label: `${inProgress ? "Reading" : "Read"} ${pluralize(files.length, "file")}`,
				aggregate: {
					key: "read-files",
					count: files.length,
					noun: "file",
					completedVerb: "Read",
					progressVerb: "Reading",
				},
				details: files.map(
					(file) => `${inProgress ? "Reading" : "Read"} ${toDisplayPath(file)}`,
				),
			};
		}
	}

	if (["search_codebase", "search"].includes(normalized)) {
		const queries = asStringArray(inputObject?.queries);
		if (queries.length > 0) {
			return {
				label: `${inProgress ? "Exploring" : "Explored"} ${pluralize(queries.length, "search")}`,
				aggregate: {
					key: "searches",
					count: queries.length,
					noun: "search",
					completedVerb: "Explored",
					progressVerb: "Exploring",
				},
				details: queries.map((query) => query),
			};
		}
	}

	if (["run_commands", "bash"].includes(normalized)) {
		const commands = extractCommands(input);
		if (commands.length > 0) {
			return {
				label: `${inProgress ? "Running" : "Ran"} ${pluralize(commands.length, "command")}`,
				aggregate: {
					key: "commands",
					count: commands.length,
					noun: "command",
					completedVerb: "Ran",
					progressVerb: "Running",
				},
				details: commands.map((command) => command.trim()),
			};
		}
	}

	if (["fetch_web_content", "web_fetch", "web-fetch"].includes(normalized)) {
		const requests = Array.isArray(inputObject?.requests)
			? inputObject.requests
			: [];
		const urls = requests
			.map((request) => {
				const requestObject = asRecord(request);
				return typeof requestObject?.url === "string"
					? requestObject.url
					: null;
			})
			.filter((url): url is string => Boolean(url));
		if (urls.length > 0) {
			return {
				label: `${inProgress ? "Exploring" : "Explored"} ${pluralize(urls.length, "link")}`,
				aggregate: {
					key: "links",
					count: urls.length,
					noun: "link",
					completedVerb: "Explored",
					progressVerb: "Exploring",
				},
				details: urls.map(
					(url) => `${inProgress ? "Fetching" : "Fetched"} ${url}`,
				),
			};
		}
	}

	if (["apply_patch", "apply-patch"].includes(normalized)) {
		const patchText =
			typeof input === "string"
				? input
				: typeof inputObject?.input === "string"
					? inputObject.input
					: "";
		const fileDiffs = patchText ? parseApplyPatchInput(patchText) : [];
		if (fileDiffs.length > 0) {
			const additions = fileDiffs.reduce((sum, d) => sum + d.additions, 0);
			const deletions = fileDiffs.reduce((sum, d) => sum + d.deletions, 0);
			return {
				label: `${inProgress ? "Editing" : "Edited"} ${pluralize(fileDiffs.length, "file")}`,
				aggregate: {
					key: "edited-files",
					count: fileDiffs.length,
					noun: "file",
					completedVerb: "Edited",
					progressVerb: "Editing",
				},
				diff: { additions, deletions },
				details: fileDiffs.map(
					(d) =>
						`${inProgress ? "Editing" : "Edited"} ${toDisplayPath(d.path)} +${d.additions} -${d.deletions}`,
				),
			};
		}
		return {
			label: inProgress ? "Applying patch" : "Applied patch",
			details: [],
		};
	}

	if (["editor", "edit_file", "edit"].includes(normalized)) {
		// Current editor schema has no `command`; derive it from the input shape.
		const command =
			typeof inputObject?.command === "string"
				? inputObject.command
				: inputObject?.insert_line != null
					? "insert"
					: typeof inputObject?.old_text === "string"
						? "str_replace"
						: typeof inputObject?.new_text === "string"
							? "create"
							: "edit";
		const path =
			typeof inputObject?.path === "string"
				? toDisplayPath(inputObject.path)
				: "file";
		const diff = parseDiffCounts(asRecord(result)?.result);
		const action = inProgress
			? command === "str_replace"
				? "Editing"
				: command === "create"
					? "Creating"
					: command === "insert"
						? "Inserting"
						: "Editing"
			: command === "str_replace"
				? "Edited"
				: command === "create"
					? "Created"
					: command === "insert"
						? "Inserted"
						: "Edited";
		// The label already carries all the information; no expandable details.
		const detail = `${action} ${path}`;
		const aggregate = {
			key: "edited-files",
			count: 1,
			noun: "file",
			completedVerb: "Edited",
			progressVerb: "Editing",
		};
		if (diff) {
			return { label: detail, aggregate, diff, details: [] };
		}
		return { label: detail, aggregate, details: [] };
	}

	const query =
		typeof asRecord(result)?.query === "string"
			? (asRecord(result)?.query as string)
			: "";
	const displayToolName = normalized.startsWith("subagent_")
		? "spawn_agent"
		: toolName;
	const fallback =
		query ||
		(inProgress ? `Running ${displayToolName}` : displayToolName) ||
		"Tool";
	return { label: fallback, details: [fallback] };
}

function buildToolSummaryFromMeta(
	toolName: string,
	kind: "exploration" | "file-edit" | "bash" | "spawn" | "tool",
	inProgress: boolean,
): ToolSummary {
	if (kind === "exploration") {
		return { label: inProgress ? "Exploring" : "Explored", details: [] };
	}
	if (kind === "file-edit") {
		return { label: inProgress ? "Editing" : "Edited", details: [] };
	}
	if (kind === "bash") {
		return {
			label: inProgress ? "Running command" : "Ran command",
			details: [],
		};
	}
	if (kind === "spawn") {
		return {
			label: inProgress ? "Spawning agent" : "Spawned agent",
			details: [],
		};
	}
	return { label: inProgress ? `Running ${toolName}` : toolName, details: [] };
}

type ToolPresentation = {
	message: ChatMessage;
	payload: ToolPayload | null;
	toolName: string;
	kind: ReturnType<typeof classifyTool>;
	inProgress: boolean;
	summary: ToolSummary;
};

function buildToolPresentation(message: ChatMessage): ToolPresentation {
	const payload = parseToolPayload(message.content);
	const toolName = message.meta?.toolName || payload?.toolName || "tool";
	const hookEventName = message.meta?.hookEventName;
	const inProgress =
		hookEventName === "tool_call_start" ||
		hookEventName === "history_tool_use" ||
		(Boolean(payload) && payload?.result == null && !payload?.isError);
	const kind = classifyTool(toolName);
	const summary = payload
		? buildToolSummary(toolName, payload.input, payload.result, inProgress)
		: buildToolSummaryFromMeta(toolName, kind, inProgress);
	return { message, payload, toolName, kind, inProgress, summary };
}

function buildGroupedToolLabel(presentations: ToolPresentation[]): string {
	if (presentations.length === 1) {
		return presentations[0]?.summary.label ?? "Tool";
	}

	type Segment =
		| { type: "label"; label: string }
		| {
				type: "aggregate";
				aggregate: NonNullable<ToolSummary["aggregate"]> & {
					inProgress: boolean;
				};
		  };
	const segments: Segment[] = [];
	for (const presentation of presentations) {
		const aggregate = presentation.summary.aggregate;
		if (!aggregate) {
			segments.push({ type: "label", label: presentation.summary.label });
			continue;
		}

		const previous = segments.at(-1);
		if (
			previous?.type === "aggregate" &&
			previous.aggregate.key === aggregate.key
		) {
			segments[segments.length - 1] = {
				type: "aggregate",
				aggregate: {
					...previous.aggregate,
					count: previous.aggregate.count + aggregate.count,
					inProgress: previous.aggregate.inProgress || presentation.inProgress,
				},
			};
			continue;
		}

		segments.push({
			type: "aggregate",
			aggregate: { ...aggregate, inProgress: presentation.inProgress },
		});
	}

	return segments
		.map((segment) => {
			if (segment.type === "label") return segment.label;
			const { aggregate } = segment;
			const verb = aggregate.inProgress
				? aggregate.progressVerb
				: aggregate.completedVerb;
			return `${verb} ${pluralize(aggregate.count, aggregate.noun)}`;
		})
		.join(". ");
}

function ToolMessageBlock({ messages }: { messages: ChatMessage[] }) {
	const presentations = messages.map(buildToolPresentation);
	const first = presentations[0];
	if (!first) return null;
	const hasError = presentations.some(({ payload }) => payload?.isError);
	const isRunning = presentations.some(({ inProgress }) => inProgress);
	const kinds = new Set(presentations.map(({ kind }) => kind));
	const kind = kinds.size === 1 ? first.kind : "tool";
	const isFileRead = presentations.every(({ toolName }) =>
		["read_files", "file_read", "file-read"].includes(toolName.toLowerCase()),
	);
	const Icon = isFileRead
		? FileIcon
		: kind === "exploration"
			? Search
			: kind === "file-edit"
				? FileEdit
				: kind === "bash"
					? SquareTerminalIcon
					: kind === "spawn"
						? Bot
						: FileSearch;
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
		details.length > 0 || inputPreviews.length > 0 || resultPreviews.length > 0;
	const diff = presentations.reduce(
		(total, { summary }) => ({
			additions: total.additions + (summary.diff?.additions ?? 0),
			deletions: total.deletions + (summary.diff?.deletions ?? 0),
		}),
		{ additions: 0, deletions: 0 },
	);

	return (
		<ToolActivity expandable={hasExpandedSections}>
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
				label={buildGroupedToolLabel(presentations)}
				status={hasError ? "error" : isRunning ? "running" : "success"}
			/>
			<ToolActivityContent>
				{details.length > 0 ? (
					<ToolActivityDetails>
						{details.map(({ detail, key }) => (
							<div key={key}>{detail}</div>
						))}
					</ToolActivityDetails>
				) : null}
				{inputPreviews.map((preview) => (
					<div className="space-y-1" key={`input_${preview.key}`}>
						<div className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
							{presentations.length > 1 ? `${preview.toolName} input` : "Input"}
						</div>
						<ToolActivityCode className="text-sm">
							{preview.value}
						</ToolActivityCode>
					</div>
				))}
				{resultPreviews.map((preview) => (
					<div className="mt-1 text-destructive" key={`result_${preview.key}`}>
						{presentations.length > 1 ? `${preview.toolName}: ` : null}
						{preview.value}
					</div>
				))}
			</ToolActivityContent>
		</ToolActivity>
	);
}
