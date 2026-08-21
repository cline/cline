"use client";

import { AgentAskQuestion } from "@cline/ui";
import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
	ConversationViewport,
	useConversation,
} from "@cline/ui/components/agent-chat";
import { Loader2 } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { toast } from "@/hooks/use-toast";
import type {
	ChatMessage,
	ChatMessageImage,
	ChatSessionStatus,
} from "@/lib/chat-schema";
import { cn } from "@/lib/utils";
import { STREAMING_TITLE_CLASS } from "./messages/constants";
import {
	buildPreviousTimestampMap,
	buildUserRunCountMap,
	collapseCompletedWork,
	getThoughtDurationMilliseconds,
	groupChatMessages,
} from "./messages/group-messages";
import { ChatImageLightbox } from "./messages/image-lightbox";
import { MessageBubble } from "./messages/message-bubble";
import {
	ToolApprovalPanel,
	type ToolApprovalRequestItem,
} from "./messages/tool-approval-panel";
import { ToolMessageBlock } from "./messages/tool-message-block";
import { buildToolPresentation } from "./messages/tool-summaries";
import { WorkBlock } from "./messages/work-block";
import { SessionContent } from "./session-content";

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
	onProceedWhileRunning?: (
		sessionId: string,
		toolCallId?: string,
	) => void | Promise<void>;
};

type AskQuestionRequestItem = {
	requestId: string;
	sessionId: string;
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
	onProceedWhileRunning,
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
	const lastToolInProgress = useMemo(
		() =>
			lastConversationMessage?.role === "tool" &&
			buildToolPresentation(lastConversationMessage).inProgress,
		[lastConversationMessage],
	);
	const isAwaitingFirstOutput =
		status === "running" &&
		!streamingMessageId &&
		!lastToolInProgress &&
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
	// The live run keeps rendering its rows while the session is active, and an
	// interrupted run (cancelled/failed/error) keeps them too — even when Stop
	// landed mid-answer and left partial trailing text — so the user can see
	// where it stopped. Only a run the agent finished folds into a summary row.
	const collapseTrailingRun = status === "completed" || status === "idle";
	const renderItems = useMemo(
		() =>
			collapseCompletedWork(groupChatMessages(messages), {
				collapseTrailingRun,
			}),
		[messages, collapseTrailingRun],
	);
	// Mid-run the thinking indicator's replacement (the next tool or thinking
	// row) joins the tight run group, so the indicator must sit at that same
	// tight offset; only at the start of a run, directly under the user
	// message, does the response block open at the normal transcript gap.
	const lastRenderItem = renderItems.at(-1);
	const indicatorFollowsWorkingRows =
		lastRenderItem !== undefined &&
		(lastRenderItem.type === "tools" ||
			lastRenderItem.type === "run" ||
			(lastRenderItem.type === "message" &&
				lastRenderItem.message.role === "assistant"));
	// Built once per pendingAskQuestions change instead of per render: the
	// list re-renders on every stream flush and these rows carry JSX.
	const askQuestionItems = useMemo(
		() =>
			pendingAskQuestions.map((item) => ({
				id: item.requestId,
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

	const getReasoningProps = useCallback(
		(reasoningMessages: ChatMessage[]) => {
			const firstReasoningMessage = reasoningMessages[0];
			const lastReasoningMessage = reasoningMessages.at(-1);
			return {
				reasoningContent: reasoningMessages
					.map((reasoningMessage) => reasoningMessage.reasoning?.trim())
					.filter((content): content is string => Boolean(content))
					.join("\n\n"),
				reasoningRedacted: reasoningMessages.some(
					(reasoningMessage) => reasoningMessage.reasoningRedacted === true,
				),
				thoughtDurationMilliseconds:
					firstReasoningMessage && lastReasoningMessage
						? getThoughtDurationMilliseconds(
								previousTimestampByMessage.get(firstReasoningMessage),
								lastReasoningMessage.createdAt,
							)
						: undefined,
			};
		},
		[previousTimestampByMessage],
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
						"min-h-full w-full min-w-0",
						showIdleDetails ? "p-0" : "px-6",
					)}
				>
					<SessionContent
						className={cn(
							"relative min-h-full",
							// Bottom padding clears a pinned action pill (~40px with its
							// offset) plus a comfortable gap before the composer, which
							// sits below the scroller, not over it.
							showIdleDetails ? "p-0" : "pt-6 pb-16",
						)}
					>
						{showIdleDetails ? null : (
							<div className="flex min-h-full w-full min-w-0 flex-col gap-4">
								{renderItems.map((item, itemIndex) => {
									// Working rows — live (`run`) or folded (`work`) — render
									// through one child renderer so a row keeps its exact look
									// and position when the run collapses. Those rows keep
									// copy/expand but drop the session-versioning actions
									// (edit, restore, fork), which belong to top-level
									// transcript rows.
									const renderWorkingRow = (child: typeof item) => {
										if (child.type === "tools") {
											return (
												<ToolMessageBlock
													key={`tools_${child.messages[0]?.id ?? "empty"}`}
													messages={child.messages}
													onProceedWhileRunning={onProceedWhileRunning}
												/>
											);
										}
										if (child.type !== "message") {
											return null;
										}
										return (
											<MessageBubble
												agentRole={child.agentRole}
												isLastAssistantMessage={
													child.message.role === "assistant" &&
													lastConversationMessage === child.message
												}
												isStreaming={streamingMessageId === child.message.id}
												key={child.message.id}
												message={child.message}
												onCopyMessage={handleCopyMessage}
												onExpandImage={handleExpandImage}
												wasCopied={copiedMessageId === child.message.id}
												{...getReasoningProps(child.reasoningMessages)}
											/>
										);
									};
									if (item.type === "tools") {
										return renderWorkingRow(item);
									}
									if (item.type === "run") {
										return (
											<div
												className="flex flex-col gap-1"
												key={`run_${item.id}`}
											>
												{item.items.map(renderWorkingRow)}
											</div>
										);
									}
									if (item.type === "work") {
										return (
											<WorkBlock
												durationMilliseconds={item.durationMilliseconds}
												key={`work_${item.id}`}
												toolCallCount={item.toolCallCount}
											>
												{item.items.map(renderWorkingRow)}
											</WorkBlock>
										);
									}
									const { agentRole, message, reasoningMessages } = item;
									// An answer directly under its run's working rows belongs
									// to them — pull it closer than the full transcript gap.
									const previousItem = renderItems[itemIndex - 1];
									const followsWorkingRows =
										message.role === "assistant" &&
										previousItem !== undefined &&
										previousItem.type !== "message";
									return (
										<MessageBubble
											agentRole={agentRole}
											followsWorkingRows={followsWorkingRows}
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
													? requestRestoreCheckpoint
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
											restorePending={
												checkpointActions[message.id] === "undoing"
											}
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
											{...getReasoningProps(reasoningMessages)}
										/>
									);
								})}
								{/* Lives inside the transcript column and mirrors a
								    reasoning/tool trigger's geometry exactly (icon slot,
								    min-height, padding), so the first real row replaces it
								    in place with no jump. */}
								{(status === "starting" || isAwaitingFirstOutput) &&
								!isSessionSwitching ? (
									<div
										className={cn(
											"flex min-h-7 items-center gap-2 py-1 text-sm font-medium text-muted-foreground",
											indicatorFollowsWorkingRows && "-mt-3",
										)}
									>
										<Loader2 className="size-4 animate-spin" />
										<span className={STREAMING_TITLE_CLASS}>Thinking...</span>
									</div>
								) : null}
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
					</SessionContent>
				</ConversationContent>
			</ConversationViewport>
			<ConversationScrollButton />
			<AutoScrollOnSend messages={messages} />
			{visibleExpandedImage ? (
				<ChatImageLightbox
					image={visibleExpandedImage}
					onClose={() => setExpandedImage(null)}
				/>
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

/**
 * Sending a message returns the reader to the newest content: whenever a new
 * user message lands in the transcript, scroll to the bottom even if the user
 * had scrolled up. Keyed off the count (not the id) because optimistic user
 * bubbles are re-keyed to their runtime id, which must not re-trigger.
 */
function AutoScrollOnSend({ messages }: { messages: ChatMessage[] }) {
	const { scrollToBottom } = useConversation();
	const userMessageCount = useMemo(
		() =>
			messages.reduce(
				(count, message) => (message.role === "user" ? count + 1 : count),
				0,
			),
		[messages],
	);
	const previousCount = useRef(userMessageCount);
	useEffect(() => {
		if (userMessageCount > previousCount.current) {
			scrollToBottom();
		}
		previousCount.current = userMessageCount;
	}, [scrollToBottom, userMessageCount]);
	return null;
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
