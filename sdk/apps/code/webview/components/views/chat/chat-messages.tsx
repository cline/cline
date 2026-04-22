"use client";

import {
	AlertCircle,
	Bot,
	ChevronDown,
	ChevronRight,
	Clock3,
	Copy,
	FileEdit,
	FileSearch,
	GitBranch,
	Loader2,
	RotateCcw,
	Search,
	ShieldAlert,
	Terminal,
} from "lucide-react";
import {
	memo,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import type { ChatMessage, ChatSessionStatus } from "@/lib/chat-schema";
import { cn } from "@/lib/utils";
import { MemoizedMarkdown } from "../../ui/markdown";
import { normalizeTitle } from "../../utils";
import { WelcomeScreen } from "./welcome-chat";

type ChatMessagesProps = {
	sessionId: string | null;
	status: ChatSessionStatus;
	chatTransportState?: "connecting" | "reconnecting" | "connected";
	isSessionSwitching?: boolean;
	provider: string;
	model: string;
	messages: ChatMessage[];
	error: string | null;
	streamingMessageId?: string | null;
	pendingToolApprovals: ToolApprovalRequestItem[];
	onApproveToolApproval: (requestId: string) => void | Promise<void>;
	onRejectToolApproval: (requestId: string) => void | Promise<void>;
	onRestoreCheckpoint?: (runCount: number) => void | Promise<void>;
	onForkSession?: () => void | Promise<void>;
	onStartChat?: (prompt: string) => void;
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

const IS_DEBUG = process.env.NODE_ENV === "test";
const STICKY_BOTTOM_THRESHOLD_PX = 24;
const SCROLL_TO_BOTTOM_BUTTON_THRESHOLD_PX = 120;

function ChatMessagesImpl({
	sessionId: _sessionId,
	status,
	chatTransportState = "connecting",
	isSessionSwitching = false,
	provider,
	model,
	messages,
	error,
	streamingMessageId = null,
	pendingToolApprovals,
	onApproveToolApproval,
	onRejectToolApproval,
	onRestoreCheckpoint,
	onForkSession,
	onStartChat,
}: ChatMessagesProps) {
	const scrollAreaRef = useRef<HTMLDivElement | null>(null);
	const shouldStickToBottomRef = useRef(true);
	const hasMessages = messages.length > 0;
	const lastErrorMessage = [...messages]
		.reverse()
		.find((message) => message.role === "error");
	const shouldShowErrorBanner =
		Boolean(error) && (!lastErrorMessage || lastErrorMessage.content !== error);
	const [showSwitchTransition, setShowSwitchTransition] = useState(false);
	const [showScrollToBottom, setShowScrollToBottom] = useState(false);
	const [toolApprovalActions, setToolApprovalActions] = useState<
		Record<string, "approving" | "rejecting">
	>({});
	const [toolApprovalErrors, setToolApprovalErrors] = useState<
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
	const showIdleDetails =
		!hasMessages && !isSessionSwitching && !showSwitchTransition;

	const getViewport = useCallback(() => {
		return scrollAreaRef.current;
	}, []);

	const scrollToBottom = useCallback(
		(behavior: ScrollBehavior = "smooth") => {
			const viewport = getViewport();
			if (!viewport) {
				return;
			}
			shouldStickToBottomRef.current = true;
			viewport.scrollTo({ top: viewport.scrollHeight, behavior });
			setShowScrollToBottom((prev) => (prev ? false : prev));
		},
		[getViewport],
	);

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
		const viewport = getViewport();
		if (!viewport) {
			return;
		}

		const updateScrollToBottomVisibility = () => {
			const distanceFromBottom =
				viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
			shouldStickToBottomRef.current =
				distanceFromBottom <= STICKY_BOTTOM_THRESHOLD_PX;
			const shouldShow =
				distanceFromBottom > SCROLL_TO_BOTTOM_BUTTON_THRESHOLD_PX;
			setShowScrollToBottom((prev) =>
				prev === shouldShow ? prev : shouldShow,
			);
		};

		updateScrollToBottomVisibility();
		viewport.addEventListener("scroll", updateScrollToBottomVisibility);

		return () => {
			viewport.removeEventListener("scroll", updateScrollToBottomVisibility);
		};
	}, [getViewport]);

	useLayoutEffect(() => {
		if (!shouldStickToBottomRef.current) {
			return;
		}
		scrollToBottom("auto");
	}, [scrollToBottom]);

	useEffect(() => {
		const activeRequestIds = new Set(
			pendingToolApprovals.map((item) => item.requestId),
		);
		setToolApprovalActions((prev) => pruneRequestMap(prev, activeRequestIds));
		setToolApprovalErrors((prev) => pruneRequestMap(prev, activeRequestIds));
	}, [pendingToolApprovals]);

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
		<div className="relative h-full min-h-0 min-w-0">
			<div
				className="h-full min-h-0 min-w-0 overflow-y-auto"
				ref={scrollAreaRef}
			>
				<div className="relative mx-auto w-full px-6 py-6">
					{showIdleDetails ? (
						<WelcomeScreen
							provider={provider}
							model={model}
							onStartChat={onStartChat ?? (() => {})}
							quickActions={[]}
						/>
					) : (
						<div className="flex flex-col gap-2 w-full h-full">
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
							{messages.map((message) => (
								<MessageBubble
									isStreaming={streamingMessageId === message.id}
									key={message.id}
									message={message}
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
							))}
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
					{status === "starting" && !isSessionSwitching ? (
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
								: "Connecting chat..."}
						</div>
					) : null}
					{shouldShowErrorBanner ? (
						<div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
							{error}
						</div>
					) : null}
				</div>
			</div>
			{showScrollToBottom ? (
				<Button
					className="absolute bottom-4 right-4 z-20 size-9 rounded-full shadow-sm"
					onClick={() => scrollToBottom("smooth")}
					size="icon"
					type="button"
					variant="secondary"
				>
					<ChevronDown className="size-4" />
					<span className="sr-only">Scroll to bottom</span>
				</Button>
			) : null}
		</div>
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
							<pre className="mt-2 max-h-44 overflow-auto rounded-md border border-border/70 bg-background p-2 text-xs text-muted-foreground">
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

function MessageBubble({
	message,
	isStreaming = false,
	onCopyRawText,
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

	if (message.role === "tool") {
		return <ToolMessageBlock message={message} />;
	}

	const normalizedContent = normalizeTitle(message.content);
	const reasoningContent = message.reasoning?.trim() || "";

	return (
		<div
			className={cn("flex", isUser ? "justify-end" : "justify-start w-full")}
		>
			<div
				className={cn(
					"space-y-2 pl-3 text-sm",
					isUser && "bg-card text-foreground/80 max-w-[50%]",
					!isUser && !isError && "text-foreground w-full",
					isError &&
						"bg-destructive/10 border border-destructive/40 text-destructive",
				)}
			>
				{isStreaming && message.role === "assistant" ? (
					<>
						{reasoningContent || message.reasoningRedacted ? (
							<ReasoningBlock
								content={reasoningContent}
								redacted={message.reasoningRedacted === true}
							/>
						) : null}
						<div className="whitespace-pre-wrap">
							{normalizedContent || " "}
						</div>
					</>
				) : (
					<>
						{reasoningContent || message.reasoningRedacted ? (
							<ReasoningBlock
								content={reasoningContent}
								redacted={message.reasoningRedacted === true}
							/>
						) : null}
						<MemoizedMarkdown
							content={normalizedContent || " "}
							id={message.id}
						/>
					</>
				)}
				{isUser && checkpoint ? (
					<div className="space-y-2 pt-1">
						<div className="flex items-center justify-end gap-2">
							<Button
								className="h-7 px-2 text-xs"
								onClick={onCopyRawText}
								size="sm"
								type="button"
								variant="outline"
							>
								<Copy className="h-3.5 w-3.5" />
								{wasCopied ? "Copied" : "Copy"}
							</Button>
							<Button
								className="h-7 px-2 text-xs"
								disabled={restoreDisabled || restorePending}
								onClick={() => onRestoreCheckpoint?.(checkpoint.runCount)}
								size="sm"
								type="button"
								variant="outline"
							>
								{restorePending ? (
									<Loader2 className="h-3.5 w-3.5 animate-spin" />
								) : (
									<RotateCcw className="h-3.5 w-3.5" />
								)}
								Undo
							</Button>
						</div>
						{restoreError ? (
							<div className="text-right text-xs text-destructive">
								{restoreError}
							</div>
						) : null}
					</div>
				) : null}
				{!isUser &&
				!isError &&
				message.role === "assistant" &&
				onForkSession ? (
					<div className="mt-1 flex items-center gap-1">
						<Button
							className="h-6 gap-1.5 px-2 text-[11px] text-muted-foreground hover:text-foreground"
							disabled={forkPending}
							onClick={onForkSession}
							size="sm"
							title="Fork session — copy full message history into a new session"
							type="button"
							variant="ghost"
						>
							{forkPending ? (
								<Loader2 className="h-3 w-3 animate-spin" />
							) : (
								<GitBranch className="h-3 w-3" />
							)}
						</Button>
						{forkError ? (
							<span className="text-[11px] text-destructive">{forkError}</span>
						) : null}
					</div>
				) : null}
			</div>
		</div>
	);
}

function ReasoningBlock({
	content,
	redacted,
}: {
	content: string;
	redacted: boolean;
}) {
	const [expanded, setExpanded] = useState(false);
	const displayContent = content || (redacted ? "[redacted]" : "");
	if (!displayContent) {
		return null;
	}

	return (
		<div className="mb-2">
			<Button
				className="w-full justify-start gap-2 p-0 text-left font-medium text-foreground/70 hover:bg-transparent text-xs"
				onClick={() => setExpanded((current) => !current)}
				type="button"
				variant="ghost"
			>
				Thinking
			</Button>
			{expanded ? (
				<div className="mt-1 whitespace-pre-wrap rounded-lg border border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground">
					{displayContent}
				</div>
			) : null}
		</div>
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
	if (["editor", "edit_file", "edit"].includes(normalized)) return "file-edit";
	if (["bash", "run_commands"].includes(normalized)) return "bash";
	if (["spawn_agent", "spawn-agent", "spawn_agent_tool"].includes(normalized))
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
		const files = asStringArray(inputObject?.file_paths);
		if (files.length > 0) {
			return {
				label: `${inProgress ? "Exploring" : "Explored"} ${pluralize(files.length, "file")}`,
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
				details: queries.map((query) => query),
			};
		}
	}

	if (["run_commands", "bash"].includes(normalized)) {
		const commands = asStringArray(inputObject?.commands);
		if (commands.length === 1) {
			return {
				label: `${inProgress ? "Running" : "Ran"} ${commands[0]}`,
				details: [commands[0]],
			};
		}
		if (commands.length > 1) {
			return {
				label: `${inProgress ? "Running" : "Ran"} ${pluralize(commands.length, "command")}`,
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
				details: urls.map(
					(url) => `${inProgress ? "Fetching" : "Fetched"} ${url}`,
				),
			};
		}
	}

	if (["editor", "edit_file", "edit"].includes(normalized)) {
		const command =
			typeof inputObject?.command === "string" ? inputObject.command : "edit";
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
		const detail = `${action} ${path}`;
		if (diff) {
			return {
				label: `${detail} +${diff.additions} -${diff.deletions}`,
				details: [detail],
			};
		}
		return { label: detail, details: [detail] };
	}

	const query =
		typeof asRecord(result)?.query === "string"
			? (asRecord(result)?.query as string)
			: "";
	const fallback =
		query || (inProgress ? `Running ${toolName}` : toolName) || "Tool";
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

function ToolMessageBlock({ message }: { message: ChatMessage }) {
	const [expanded, setExpanded] = useState(false);
	const payload = parseToolPayload(message.content);
	const toolName = message.meta?.toolName || payload?.toolName || "tool";
	const hookEventName = message.meta?.hookEventName;
	const inProgress =
		hookEventName === "tool_call_start" ||
		hookEventName === "history_tool_use" ||
		(Boolean(payload) && payload?.result == null && !payload?.isError);
	const kind = classifyTool(toolName);
	const Icon =
		kind === "exploration"
			? Search
			: kind === "file-edit"
				? FileEdit
				: kind === "bash"
					? Terminal
					: kind === "spawn"
						? Bot
						: FileSearch;
	const summary = payload
		? buildToolSummary(toolName, payload.input, payload.result, inProgress)
		: buildToolSummaryFromMeta(toolName, kind, inProgress);
	const details = summary.details;
	const inputPreview =
		IS_DEBUG && payload ? formatToolValue(payload.input) : "";
	const resultPreview = payload?.isError ? formatToolValue(payload.result) : "";
	const hasExpandedSections =
		details.length > 1 || Boolean(inputPreview || resultPreview);

	return (
		<div className="flex justify-start w-full">
			<div className={cn("w-full rounded-xl text-xs")}>
				<Button
					className="w-full justify-start gap-2 p-0 text-left font-medium text-foreground/70 hover:bg-transparent text-xs"
					onClick={() => setExpanded((current) => !current)}
					type="button"
					variant="ghost"
				>
					{payload?.isError ? (
						<AlertCircle className="size-3 text-destructive/80" />
					) : (
						<Icon className="size-3" />
					)}
					<span>{summary.label}</span>
					{hasExpandedSections ? (
						<span className="text-muted-foreground">
							{expanded ? (
								<ChevronDown className="size-3" />
							) : (
								<ChevronRight className="size-3" />
							)}
						</span>
					) : null}
				</Button>
				{expanded ? (
					<div className="pl-8 text-muted-foreground">
						{hasExpandedSections ? (
							<div className="space-y-1">
								{details.map((detail) => (
									<div className="text-xxs" key={`${message.id}_${detail}`}>
										{detail}
									</div>
								))}
							</div>
						) : null}
						{inputPreview ? (
							<div className="space-y-1">
								<div className="text-xxs uppercase tracking-wide text-muted-foreground/80">
									Input
								</div>
								<pre className="max-h-52 overflow-auto rounded-md border border-border/70 bg-background/60 p-2 text-xxs leading-relaxed text-foreground whitespace-pre-wrap break-all">
									{inputPreview}
								</pre>
							</div>
						) : null}
						{resultPreview ? (
							payload?.isError ? (
								<div className="mt-1">
									<span className="text-destructive">{resultPreview}</span>
								</div>
							) : (
								<div className="space-y-1">
									<pre className="max-h-64 overflow-auto rounded-md border border-border/70 bg-background/60 p-2 text-xxs leading-relaxed text-foreground whitespace-pre-wrap break-all">
										{resultPreview}
									</pre>
								</div>
							)
						) : null}
					</div>
				) : null}
			</div>
		</div>
	);
}
