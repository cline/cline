"use client";

import { AgentApprovalCard, AgentAskQuestion } from "@cline/ui";
import {
	Message as AgentMessage,
	type AgentMessageRole,
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
	BlocksIcon,
	BoxIcon,
	BrainIcon,
	Check,
	Clock3,
	Copy,
	FilesIcon,
	LibraryIcon,
	Loader2,
	type LucideIcon,
	MessageCircleQuestionMarkIcon,
	PanelsTopLeftIcon,
	PencilIcon,
	SearchCodeIcon,
	ShieldAlert,
	SplitIcon,
	SquareArrowRightIcon,
	TerminalIcon,
	UndoIcon,
	UserIcon,
	UsersIcon,
	WrenchIcon,
	X,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
	onEditMessage?: (
		messageId: string,
		content: string,
		runCount: number,
	) => void | Promise<void>;
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
	| {
			type: "message";
			agentRole: AgentMessageRole;
			message: ChatMessage;
			reasoningMessages: ChatMessage[];
	  }
	| { type: "tools"; messages: ChatMessage[] };

function hasMessageReasoning(message: ChatMessage): boolean {
	return Boolean(message.reasoning?.trim() || message.reasoningRedacted);
}

function isReasoningOnlyAssistantMessage(message: ChatMessage): boolean {
	return (
		message.role === "assistant" &&
		hasMessageReasoning(message) &&
		!message.content.trim() &&
		!message.images?.length
	);
}

function buildPreviousTimestampMap(
	messages: ChatMessage[],
): Map<ChatMessage, number | undefined> {
	const previousTimestampByMessage = new Map<ChatMessage, number | undefined>();
	let previousTimestamp: number | undefined;

	for (const message of messages) {
		previousTimestampByMessage.set(message, previousTimestamp);
		if (Number.isFinite(message.createdAt)) {
			previousTimestamp = message.createdAt;
		}
	}

	return previousTimestampByMessage;
}

function buildUserRunCountMap(
	messages: ChatMessage[],
): Map<ChatMessage, number> {
	const runCountByMessage = new Map<ChatMessage, number>();
	let lastRunCount = 0;

	for (const message of messages) {
		const userRunSpan =
			message.meta?.userRunSpan ?? (message.role === "user" ? 1 : 0);
		const storedRunCount =
			message.meta?.runCount ?? message.meta?.checkpoint?.runCount;
		if (storedRunCount !== undefined) {
			lastRunCount = Math.max(lastRunCount, storedRunCount);
			if (message.role === "user" && userRunSpan === 1) {
				runCountByMessage.set(message, storedRunCount);
			}
			continue;
		}
		lastRunCount += userRunSpan;
		if (message.role === "user" && userRunSpan === 1) {
			runCountByMessage.set(message, lastRunCount);
		}
	}

	return runCountByMessage;
}

function getThoughtDurationMilliseconds(
	previousTimestamp: number | undefined,
	thinkingTimestamp: number,
): number | undefined {
	if (
		previousTimestamp === undefined ||
		!Number.isFinite(previousTimestamp) ||
		!Number.isFinite(thinkingTimestamp) ||
		thinkingTimestamp < previousTimestamp
	) {
		return undefined;
	}

	return thinkingTimestamp - previousTimestamp;
}

function formatThoughtLabel(durationMilliseconds?: number): string {
	if (durationMilliseconds === undefined) {
		return "Thinking";
	}

	const seconds =
		durationMilliseconds === 0
			? 0
			: Math.max(1, Math.round(durationMilliseconds / 1000));

	return `Thought for ${seconds}s`;
}

function groupChatMessages(messages: ChatMessage[]): ChatRenderItem[] {
	const items: ChatRenderItem[] = [];
	let pendingReasoningMessages: ChatMessage[] = [];

	const pushMessage = (
		message: ChatMessage,
		agentRole: AgentMessageRole,
		reasoningMessages = hasMessageReasoning(message) ? [message] : [],
	) => {
		items.push({
			type: "message",
			agentRole,
			message,
			reasoningMessages,
		});
	};

	const flushPendingReasoning = () => {
		const message = pendingReasoningMessages.at(-1);
		if (!message) {
			return;
		}
		pushMessage(message, "assistant", pendingReasoningMessages);
		pendingReasoningMessages = [];
	};

	for (const message of messages) {
		if (isReasoningOnlyAssistantMessage(message)) {
			pendingReasoningMessages.push(message);
			continue;
		}

		if (message.role === "assistant" && pendingReasoningMessages.length > 0) {
			const reasoningMessages = hasMessageReasoning(message)
				? [...pendingReasoningMessages, message]
				: pendingReasoningMessages;
			pushMessage(message, "assistant", reasoningMessages);
			pendingReasoningMessages = [];
			continue;
		}

		flushPendingReasoning();
		const previous = items.at(-1);
		if (message.role === "tool") {
			if (previous?.type === "tools") {
				previous.messages.push(message);
			} else {
				items.push({ type: "tools", messages: [message] });
			}
			continue;
		}
		pushMessage(message, message.role);
	}
	flushPendingReasoning();
	return items;
}

const IS_DEBUG = process.env.NODE_ENV === "test";
const STREAMING_TITLE_CLASS = "cline-chat-streaming-title";
/** Keeps a scroller's X axis live while hiding its horizontal bar (globals.css). */
const SCROLL_X_BARE_CLASS = "cline-chat-scroll-x-bare";

/**
 * Expanded reasoning and tool panels hang off a shared left rail: the border
 * sits 8px in, centered under the 16px trigger icon, and the content is padded
 * 16px so panel text lines up with the trigger label above it. Both panels must
 * use this verbatim, and it overrides the panel chrome (border box, radius,
 * background, inset) that `agent-chat.css` gives each of them by default.
 *
 * Both panels are capped on both axes so a long thought or a wide command list
 * can never stretch the conversation column; each panel then picks which axes
 * scroll (reasoning wraps and scrolls Y only, tools scroll both).
 */
const EXPANDED_PANEL_RAIL_CLASS =
	"ml-1 mt-0 max-h-48 max-w-full rounded-none border-0 border-l border-border bg-transparent py-1 px-2 text-sm opacity-70 hover:opacity-100 focus-within:opacity-100";

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
	onEditMessage,
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
	const [checkpointConfirmation, setCheckpointConfirmation] = useState<{
		messageId: string;
		runCount: number;
	} | null>(null);
	const [editConfirmation, setEditConfirmation] = useState<{
		messageId: string;
		content: string;
		runCount: number;
	} | null>(null);
	const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
	const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
	const [editErrors, setEditErrors] = useState<Record<string, string>>({});
	const [forkingMessageId, setForkingMessageId] = useState<string | null>(null);
	const [forkErrors, setForkErrors] = useState<Record<string, string>>({});
	const [expandedImage, setExpandedImage] = useState<{
		sessionId: string | null;
		image: ChatMessageImage;
	} | null>(null);
	const sessionVersioningPending =
		editingMessageId !== null ||
		forkingMessageId !== null ||
		Object.values(checkpointActions).includes("undoing");
	const visibleExpandedImage =
		expandedImage?.sessionId === sessionId ? expandedImage.image : null;
	const showIdleDetails =
		!hasMessages && !isSessionSwitching && !showSwitchTransition;
	const renderItems = useMemo(() => groupChatMessages(messages), [messages]);
	const previousTimestampByMessage = useMemo(
		() => buildPreviousTimestampMap(messages),
		[messages],
	);
	const userRunCountByMessage = useMemo(
		() => buildUserRunCountMap(messages),
		[messages],
	);

	useEffect(() => {
		void sessionId;
		setCheckpointConfirmation(null);
		setEditConfirmation(null);
	}, [sessionId]);

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

	const handleEditMessage = useCallback(
		async (messageId: string, content: string, runCount: number) => {
			if (!onEditMessage) {
				return;
			}
			setEditingMessageId(messageId);
			setEditErrors((prev) => {
				if (!prev[messageId]) {
					return prev;
				}
				const next = { ...prev };
				delete next[messageId];
				return next;
			});
			try {
				await Promise.resolve(onEditMessage(messageId, content, runCount));
			} catch (err) {
				const message =
					err instanceof Error
						? err.message
						: "Could not restart from this message.";
				setEditErrors((prev) => ({ ...prev, [messageId]: message }));
			} finally {
				setEditingMessageId((current) =>
					current === messageId ? null : current,
				);
			}
		},
		[onEditMessage],
	);
	const requestEditMessage = useCallback(
		(messageId: string, content: string, runCount: number) => {
			setEditConfirmation({ messageId, content, runCount });
		},
		[],
	);

	const handleExpandImage = useCallback(
		(image: ChatMessageImage) => {
			setExpandedImage({ sessionId, image });
		},
		[sessionId],
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
						"relative mx-auto min-h-full w-full min-w-0 max-w-full",
						showIdleDetails ? "p-0" : "px-6 py-6",
					)}
				>
					{showIdleDetails ? null : (
						<div className="flex min-h-full w-full min-w-0 flex-col gap-2">
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
								<AgentAskQuestion
									errors={askQuestionErrors}
									items={pendingAskQuestions.map((item) => ({
										description: (
											<>
												Request {item.requestId}
												{item.context?.iteration != null
													? ` · Iteration ${item.context.iteration}`
													: ""}
											</>
										),
										id: item.requestId,
										meta: (
											<>
												<Clock3 className="h-3 w-3" />
												{formatApprovalTimestamp(item.createdAt)}
											</>
										),
										options: item.options,
										question: item.question,
									}))}
									onAnswer={handleAskQuestionAnswer}
									pendingAnswers={askQuestionActions}
								/>
							) : null}
							{renderItems.map((item) => {
								if (item.type === "tools") {
									return (
										<ToolMessageBlock
											key={`tools_${item.messages[0]?.id ?? "empty"}`}
											messages={item.messages}
										/>
									);
								}
								const { agentRole, message, reasoningMessages } = item;
								const firstReasoningMessage = reasoningMessages[0];
								const lastReasoningMessage = reasoningMessages.at(-1);
								const reasoningContent = reasoningMessages
									.map((reasoningMessage) => reasoningMessage.reasoning?.trim())
									.filter((content): content is string => Boolean(content))
									.join("\n\n");
								return (
									<MessageBubble
										agentRole={agentRole}
										isLastAssistantMessage={
											message.role === "assistant" &&
											lastConversationMessage === message
										}
										isStreaming={streamingMessageId === message.id}
										key={message.id}
										message={message}
										runCount={userRunCountByMessage.get(message)}
										onExpandImage={handleExpandImage}
										onCopyMessage={handleCopyMessage}
										onEditMessage={
											onEditMessage ? requestEditMessage : undefined
										}
										editDisabled={
											!onEditMessage ||
											status === "starting" ||
											status === "running" ||
											status === "stopping" ||
											isSessionSwitching ||
											sessionVersioningPending
										}
										editError={editErrors[message.id]}
										editPending={editingMessageId === message.id}
										onRestoreCheckpoint={
											onRestoreCheckpoint
												? (messageId, runCount) =>
														setCheckpointConfirmation({
															messageId,
															runCount,
														})
												: undefined
										}
										restoreDisabled={
											!onRestoreCheckpoint ||
											status === "starting" ||
											status === "running" ||
											status === "stopping" ||
											isSessionSwitching ||
											sessionVersioningPending
										}
										restoreError={checkpointErrors[message.id]}
										restorePending={checkpointActions[message.id] === "undoing"}
										wasCopied={copiedMessageId === message.id}
										onForkSession={
											onForkSession ? handleForkSession : undefined
										}
										forkDisabled={
											status === "starting" ||
											status === "running" ||
											status === "stopping" ||
											isSessionSwitching ||
											sessionVersioningPending
										}
										forkPending={forkingMessageId === message.id}
										forkError={forkErrors[message.id]}
										reasoningContent={reasoningContent}
										reasoningRedacted={reasoningMessages.some(
											(reasoningMessage) =>
												reasoningMessage.reasoningRedacted === true,
										)}
										thoughtDurationMilliseconds={
											firstReasoningMessage && lastReasoningMessage
												? getThoughtDurationMilliseconds(
														previousTimestampByMessage.get(
															firstReasoningMessage,
														),
														lastReasoningMessage.createdAt,
													)
												: undefined
										}
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
							<span className={STREAMING_TITLE_CLASS}>Thinking...</span>
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
			<AlertDialog
				open={checkpointConfirmation !== null}
				onOpenChange={(open) => {
					if (!open) {
						setCheckpointConfirmation(null);
					}
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Revert to this checkpoint?</AlertDialogTitle>
						<AlertDialogDescription>
							Workspace files and conversation history after this point will be
							discarded. This cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							onClick={() => {
								const confirmation = checkpointConfirmation;
								setCheckpointConfirmation(null);
								if (confirmation) {
									void handleRestoreCheckpoint(
										confirmation.messageId,
										confirmation.runCount,
									);
								}
							}}
						>
							Revert
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
			<AlertDialog
				open={editConfirmation !== null}
				onOpenChange={(open) => {
					if (!open) {
						setEditConfirmation(null);
					}
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Edit and restart from here?</AlertDialogTitle>
						<AlertDialogDescription>
							This creates a new session and restores the workspace to its
							checkpoint before placing this message in the composer. Workspace
							and conversation changes after this point will be discarded.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							onClick={() => {
								const confirmation = editConfirmation;
								setEditConfirmation(null);
								if (confirmation) {
									void handleEditMessage(
										confirmation.messageId,
										confirmation.content,
										confirmation.runCount,
									);
								}
							}}
						>
							Continue
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
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
					const error = requestErrors[item.requestId];
					return (
						<AgentApprovalCard
							description={
								<>
									Request {item.requestId}
									{item.iteration != null
										? ` · Iteration ${item.iteration}`
										: ""}
								</>
							}
							detail={formatApprovalInput(item.input)}
							error={error}
							key={item.requestId}
							meta={
								<>
									<Clock3 className="h-3 w-3" />
									{formatApprovalTimestamp(item.createdAt)}
								</>
							}
							onApprove={() => onApprove(item.requestId)}
							onReject={() => onReject(item.requestId)}
							responding={
								pendingAction === "approving"
									? "approve"
									: pendingAction === "rejecting"
										? "reject"
										: undefined
							}
							title={item.toolName}
						/>
					);
				})}
			</div>
		</section>
	);
}

// Memoized with id-parameterized callbacks: during streaming only the message
// object that received a delta changes identity, so all other bubbles skip
// re-rendering (and re-running their Markdown pipeline) per flush.
const MessageBubble = memo(function MessageBubble({
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
			className="shrink-0 whitespace-nowrap text-[11px] leading-none text-muted-foreground"
			dateTime={messageDate.toISOString()}
			title={messageDate.toLocaleString()}
		>
			{messageTime}
		</time>
	) : null;

	// Spacing between blocks comes solely from the conversation list's `gap-2`
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
									className="max-h-56.25 max-w-56.25 object-contain"
									src={`data:${image.mediaType};base64,${image.data}`}
								/>
							</button>
						))}
					</div>
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
					<MessageActions
						className="absolute right-0 top-full z-10 -translate-y-2"
						visible={keepUserActionsVisible}
					>
						{onCopyMessage ? (
							<MessageAction
								className="min-w-0 p-0"
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
								className="min-w-0 p-0"
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
								className="min-w-0 p-0"
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
				<MessageActions
					className="absolute left-0 top-full z-10 -translate-y-2"
					visible={keepAssistantActionsVisible}
				>
					{onCopyMessage ? (
						<MessageAction
							className="min-w-0 p-0"
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
							className="min-w-0 p-0"
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

function ReasoningBlock({
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
					"overflow-x-hidden overflow-y-auto",
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

const TOOL_NAME_ALIASES: Record<string, string> = {
	"apply-patch": "apply_patch",
	bash: "run_commands",
	edit: "editor",
	edit_file: "editor",
	"file-read": "read_files",
	file_read: "read_files",
	search: "search_codebase",
	"spawn-agent": "spawn_agent",
	spawn_agent_tool: "spawn_agent",
	"web-fetch": "fetch_web_content",
	web_fetch: "fetch_web_content",
};

function normalizeToolName(toolName: string): string {
	const normalized = toolName.toLowerCase();
	return TOOL_NAME_ALIASES[normalized] ?? normalized;
}

function classifyTool(
	toolName: string,
): "exploration" | "file-edit" | "bash" | "spawn" | "tool" {
	const normalized = normalizeToolName(toolName);
	if (
		["search_codebase", "read_files", "fetch_web_content", "skills"].includes(
			normalized,
		)
	)
		return "exploration";
	if (["editor", "apply_patch"].includes(normalized)) return "file-edit";
	if (normalized === "run_commands") return "bash";
	if (normalized === "spawn_agent" || normalized.startsWith("subagent_"))
		return "spawn";
	return "tool";
}

const TOOL_NAME_ICONS: Record<string, LucideIcon> = {
	apply_patch: PencilIcon,
	ask_question: MessageCircleQuestionMarkIcon,
	editor: PencilIcon,
	fetch_web_content: PanelsTopLeftIcon,
	mcp: BoxIcon,
	plugins: BlocksIcon,
	read_files: FilesIcon,
	run_commands: TerminalIcon,
	search_codebase: SearchCodeIcon,
	skills: LibraryIcon,
	spawn_agent: UserIcon,
	submit_and_exit: SquareArrowRightIcon,
};

const TOOL_KIND_ICONS: Record<ReturnType<typeof classifyTool>, LucideIcon> = {
	bash: TerminalIcon,
	exploration: SearchCodeIcon,
	"file-edit": PencilIcon,
	spawn: UserIcon,
	tool: WrenchIcon,
};

function getToolNameIcon(toolName: string): LucideIcon {
	const normalized = normalizeToolName(toolName);
	if (normalized.startsWith("subagent_")) {
		return UserIcon;
	}
	if (
		normalized === "team" ||
		normalized === "teams" ||
		normalized.startsWith("team_")
	) {
		return UsersIcon;
	}
	return (
		TOOL_NAME_ICONS[normalized] ?? TOOL_KIND_ICONS[classifyTool(normalized)]
	);
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
	const normalized = normalizeToolName(toolName);
	const inputObject = asRecord(input);

	if (normalized === "read_files") {
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

	if (normalized === "search_codebase") {
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

	if (normalized === "run_commands") {
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

	if (normalized === "fetch_web_content") {
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

	if (normalized === "apply_patch") {
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

	if (normalized === "editor") {
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

// Memoized with element-wise comparison: the grouping pass wraps the same
// message objects in fresh arrays every commit, so reference-comparing the
// contents lets finished tool blocks skip re-rendering during streaming.
const ToolMessageBlock = memo(
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
				{/* `overflow-auto` (not just `-y`) overrides the `overflow-x: hidden`
				    that agent-chat.css pins on this panel; the bare-scrollbar class
				    then hides the horizontal bar without disabling the axis. */}
				<ToolActivityContent
					className={cn(
						EXPANDED_PANEL_RAIL_CLASS,
						"overflow-auto",
						SCROLL_X_BARE_CLASS,
					)}
				>
					{details.length > 0 ? (
						// Commands and paths stay on one line and scroll with the panel;
						// the stylesheet's `overflow-wrap: anywhere` would otherwise break
						// them mid-token and leave the X axis unreachable.
						<ToolActivityDetails className="w-max whitespace-pre">
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
							{/* Drop the stylesheet's own 13rem scroller so the panel above
							    is the single scroll container on both axes. */}
							<ToolActivityCode className="max-h-none overflow-visible text-sm">
								{preview.value}
							</ToolActivityCode>
						</div>
					))}
					{resultPreviews.map((preview) => (
						<div
							className="mt-1 text-destructive"
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
