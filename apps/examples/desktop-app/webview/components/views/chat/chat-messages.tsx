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
import { ToolFileDiff } from "@cline/ui/components/agent-chat/tool-diff";
import { buildGroupedToolLabel } from "@cline/ui/components/agent-chat/tool-summary";
import {
	AlertCircle,
	BrainIcon,
	Check,
	Clock3,
	Copy,
	Loader2,
	PencilIcon,
	ShieldAlert,
	SplitIcon,
	UndoIcon,
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
import { cn } from "@/lib/utils";
import { MemoizedMarkdown } from "../../ui/markdown";
import { formatChatMessageContent } from "./message-content";
import {
	EXPANDED_PANEL_RAIL_CLASS,
	IS_DEBUG,
	STREAMING_TITLE_CLASS,
} from "./messages/constants";
import {
	buildPreviousTimestampMap,
	buildUserRunCountMap,
	formatThoughtLabel,
	getThoughtDurationMilliseconds,
	groupChatMessages,
} from "./messages/group-messages";
import { getToolNameIcon } from "./messages/tool-icons";
import {
	buildToolPresentation,
	formatToolValue,
} from "./messages/tool-summaries";

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
	// Scanned from the tail without copying: this component re-renders on
	// every stream flush, so a reversed array clone per render would churn
	// with transcript length.
	const { lastConversationMessage, lastErrorMessage } = useMemo(() => {
		let conversationMessage: ChatMessage | undefined;
		let errorMessage: ChatMessage | undefined;
		for (let index = messages.length - 1; index >= 0; index--) {
			const message = messages[index];
			if (!conversationMessage && message.role !== "status") {
				conversationMessage = message;
			}
			if (!errorMessage && message.role === "error") {
				errorMessage = message;
			}
			if (conversationMessage && errorMessage) {
				break;
			}
		}
		return {
			lastConversationMessage: conversationMessage,
			lastErrorMessage: errorMessage,
		};
	}, [messages]);
	const shouldShowErrorBanner =
		Boolean(error) && (!lastErrorMessage || lastErrorMessage.content !== error);
	// Core reports "running" as soon as the turn is dispatched, well before the
	// first streamed chunk arrives, so keep the thinking indicator up until the
	// model produces output (or something else needs the user's attention).
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
	// Built once per pendingAskQuestions change instead of per render: the
	// list re-renders on every stream flush and these rows carry JSX.
	const askQuestionItems = useMemo(
		() =>
			pendingAskQuestions.map((item) => ({
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
			})),
		[pendingAskQuestions],
	);
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
	// Stable identity so memoized MessageBubbles skip re-rendering on stream
	// flushes; an inline lambda here would invalidate every bubble per flush.
	const requestRestoreCheckpoint = useCallback(
		(messageId: string, runCount: number) => {
			setCheckpointConfirmation({ messageId, runCount });
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
							{askQuestionItems.length > 0 ? (
								<AgentAskQuestion
									errors={askQuestionErrors}
									items={askQuestionItems}
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
											onRestoreCheckpoint ? requestRestoreCheckpoint : undefined
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
						<div className="cline-chat-selectable mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
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
						className="absolute right-0 top-full z-10 -translate-y-1"
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
					className="absolute left-0 top-full z-10 -translate-y-1"
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

// Memoized with element-wise comparison: the grouping pass wraps the same
// message objects in fresh arrays every commit, so reference-comparing the
// contents lets finished tool blocks skip re-rendering during streaming.
const ToolMessageBlock = memo(
	function ToolMessageBlock({ messages }: { messages: ChatMessage[] }) {
		const presentations = messages.map(buildToolPresentation);
		const hasFileDiffs = presentations.some(({ summary }) =>
			summary.items.some(
				(item) =>
					item.type === "file" && (item.newText !== undefined || item.diff),
			),
		);
		// Edit rows open pre-expanded so their diffs are immediately visible.
		// `defaultOpen` alone misses the streaming path: a group mounts with its
		// first (often read) call and only gains the edit later, so open when a
		// diff first arrives — unless the user has taken over the disclosure.
		const [open, setOpen] = useState(hasFileDiffs);
		const [userToggled, setUserToggled] = useState(false);
		useEffect(() => {
			if (hasFileDiffs && !userToggled) {
				setOpen(true);
			}
		}, [hasFileDiffs, userToggled]);
		const handleOpenChange = useCallback((nextOpen: boolean) => {
			setUserToggled(true);
			setOpen(nextOpen);
		}, []);
		if (presentations.length === 0) return null;
		const hasError = presentations.some(({ payload }) => payload?.isError);
		const isRunning = presentations.some(({ inProgress }) => inProgress);
		const label = buildGroupedToolLabel(
			presentations.map(({ summary, inProgress }) => ({
				label: summary.label,
				aggregate: summary.aggregate,
				inProgress,
			})),
		);
		const icons = presentations.map(({ toolName }) =>
			getToolNameIcon(toolName),
		);
		const firstIcon = icons[0] ?? WrenchIcon;
		const Icon = icons.every((icon) => icon === firstIcon)
			? firstIcon
			: WrenchIcon;
		// Index-based keys: identical detail lines (the same file read twice)
		// would collide on a content-derived key.
		const details = presentations.flatMap(({ message, summary }) =>
			summary.details.map((detail, index) => ({
				detail,
				key: `${message.id}_${index}`,
			})),
		);
		const fileDiffs = presentations.flatMap(({ message, summary }) =>
			summary.items.flatMap((item, index) =>
				item.type === "file" && (item.newText !== undefined || item.diff)
					? [{ item, key: `${message.id}_diff_${index}` }]
					: [],
			),
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
		const errorPreviews = presentations
			.map(({ message, summary, toolName }) => ({
				key: message.id,
				toolName,
				value: summary.errorText ?? "",
			}))
			.filter(({ value }) => Boolean(value));
		const hasExpandedSections =
			details.length > 0 ||
			fileDiffs.length > 0 ||
			inputPreviews.length > 0 ||
			errorPreviews.length > 0;
		const diff = presentations.reduce(
			(total, { summary }) => ({
				additions: total.additions + (summary.diff?.additions ?? 0),
				deletions: total.deletions + (summary.diff?.deletions ?? 0),
			}),
			{ additions: 0, deletions: 0 },
		);

		return (
			<ToolActivity
				className="my-0"
				expandable={hasExpandedSections}
				onOpenChange={handleOpenChange}
				open={open}
			>
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
					{fileDiffs.map((entry) =>
						entry.item.newText !== undefined ? (
							<ToolFileDiff
								className="mt-1"
								fragment={entry.item.fragment}
								key={entry.key}
								newText={entry.item.newText}
								oldText={entry.item.oldText}
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
					{errorPreviews.map((preview) => (
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
