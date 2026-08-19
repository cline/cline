"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	serializeAttachments,
	toChatMessageImages,
} from "@/hooks/chat-session/attachments";
import { getInitialChatConfig } from "@/hooks/chat-session/constants";
import {
	buildToolPayloadString,
	extractAssistantTurnDataFromRpcMessages,
	inferHydratedChatStatus,
	makeId,
	normalizeRuntimeConfig,
	resolveCredentialError,
} from "@/hooks/chat-session/helpers";
import type {
	AgentChunkEvent,
	AskQuestionRequestItem,
	ChatApiResult,
	ChatSessionCommandResponse,
	ChatSessionHookEvent,
	ChatTransportState,
	ChatUsageEvent,
	CoreLogChunk,
	ProcessContext,
	PromptInQueue,
	ReasoningDeltaEvent,
	ToolApprovalRequestItem,
	ToolCallEndEvent,
	ToolCallStartEvent,
	ToolCallUpdateEvent,
} from "@/hooks/chat-session/types";
import {
	type ChatMessage,
	ChatMessageImageSchema,
	ChatMessageMediaSchema,
	type ChatSessionConfig,
	ChatSessionConfigSchema,
	type ChatSessionStatus,
} from "@/lib/chat-schema";
import { appendCappedCommandOutput } from "@/lib/command-output";
import { desktopClient } from "@/lib/desktop-client";
import {
	buildSessionDiffState,
	EMPTY_DIFF_SUMMARY,
	type SessionDiffSummary,
	type SessionFileDiff,
	type SessionHookEvent,
} from "@/lib/session-diff";
import type {
	SessionHistoryItem,
	SessionHistoryStatus,
} from "@/lib/session-history";
import {
	normalizeWorkspacePath,
	readWorkspaceSelectionFromWindow,
	registerHostHomeDirectory,
} from "@/lib/workspace-paths";

export { DEFAULT_CHAT_CONFIG } from "@/hooks/chat-session/constants";

const MAX_MESSAGES = 800;

// How long streamed text/reasoning deltas are buffered before a React commit.
// ~3 frames: fast enough to feel live, slow enough to absorb per-token events.
const STREAM_FLUSH_INTERVAL_MS = 48;

// How long a turn-end canonical history reconcile waits before reading the
// persisted transcript. The runtime's final transcript flush (tool results and
// turn metadata) races the done event by a few milliseconds, so an immediate
// read could catch the file mid-rewrite.
const TURN_END_RECONCILE_DELAY_MS = 250;

const RELEVANT_STREAMS = new Set([
	"chat_text",
	"chat_reasoning",
	"chat_media",
	"chat_queued_prompt_start",
	"chat_tool_call_start",
	"chat_tool_call_update",
	"chat_tool_call_end",
	"chat_core_log",
	"chat_usage",
	"chat_done",
]);

const BUSY_STATUSES = new Set<ChatSessionStatus>([
	"starting",
	"running",
	"stopping",
]);

type PendingToolOutput = {
	text: string;
	truncated: boolean;
	detachable?: boolean;
};

// ---------------------------------------------------------------------------
// Helpers (pure, no hooks)
// ---------------------------------------------------------------------------

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function makeErrorChatMessage(
	sid: string | null,
	content: string,
): ChatMessage {
	return {
		id: makeId("error"),
		sessionId: sid,
		role: "error",
		content,
		createdAt: Date.now(),
	};
}

function validateConfig(
	config: ChatSessionConfig,
):
	| { parsed: ChatSessionConfig; error: null }
	| { parsed: null; error: string } {
	const runtimeConfig = normalizeRuntimeConfig(config);
	const result = ChatSessionConfigSchema.safeParse(runtimeConfig);
	if (!result.success) {
		return {
			parsed: null,
			error: result.error.issues.map((i) => i.message).join(", "),
		};
	}
	const credentialError = resolveCredentialError(result.data);
	if (credentialError) {
		return { parsed: null, error: credentialError };
	}
	return { parsed: result.data, error: null };
}

function sliceMessages(msgs: ChatMessage[]): ChatMessage[] {
	return msgs.length > MAX_MESSAGES ? msgs.slice(-MAX_MESSAGES) : msgs;
}

function sortMessagesChronologically(messages: ChatMessage[]): ChatMessage[] {
	return [...messages].sort((left, right) => {
		if (left.createdAt !== right.createdAt) {
			return left.createdAt - right.createdAt;
		}
		return left.id.localeCompare(right.id);
	});
}

function chunkCreatedAt(payload: AgentChunkEvent): number {
	return payload.ts || Date.now();
}

function mergeHydratedMessagesWithLive(options: {
	hydrated: ChatMessage[];
	current: ChatMessage[];
	sessionId: string;
	hydrationStartedAt: number;
}): ChatMessage[] {
	const { hydrated, current, sessionId, hydrationStartedAt } = options;
	const liveDuringHydration = current.filter(
		(message) =>
			message.sessionId === sessionId &&
			message.createdAt >= hydrationStartedAt,
	);
	if (liveDuringHydration.length === 0) {
		return hydrated;
	}
	const hydratedKeyCounts = new Map<string, number>();
	for (const message of hydrated) {
		const key = `${message.role}\u0000${message.content}\u0000${message.reasoning ?? ""}`;
		hydratedKeyCounts.set(key, (hydratedKeyCounts.get(key) ?? 0) + 1);
	}
	const nonDuplicateLive = liveDuringHydration.filter((message) => {
		const key = `${message.role}\u0000${message.content}\u0000${message.reasoning ?? ""}`;
		const hydratedCount = hydratedKeyCounts.get(key) ?? 0;
		if (hydratedCount > 0) {
			if (hydratedCount === 1) {
				hydratedKeyCounts.delete(key);
			} else {
				hydratedKeyCounts.set(key, hydratedCount - 1);
			}
			return false;
		}
		return true;
	});
	return sortMessagesChronologically([...hydrated, ...nonDuplicateLive]);
}

function deriveLiveToolState(messages: ChatMessage[]): {
	messageIds: Record<string, string>;
	inputs: Record<string, unknown>;
} {
	const messageIds: Record<string, string> = {};
	const inputs: Record<string, unknown> = {};
	for (const message of sortMessagesChronologically(messages)) {
		const toolCallId = message.meta?.toolCallId;
		if (!toolCallId) continue;
		const hookEventName = message.meta?.hookEventName;
		if (
			hookEventName === "tool_call_end" ||
			hookEventName === "history_tool_result"
		) {
			delete messageIds[toolCallId];
			delete inputs[toolCallId];
			continue;
		}
		if (
			hookEventName !== "tool_call_start" &&
			hookEventName !== "history_tool_use"
		) {
			continue;
		}
		messageIds[toolCallId] = message.id;
		try {
			const payload = JSON.parse(message.content) as unknown;
			if (
				payload &&
				typeof payload === "object" &&
				!Array.isArray(payload) &&
				Object.hasOwn(payload, "input")
			) {
				inputs[toolCallId] = (payload as { input?: unknown }).input;
			}
		} catch {
			// Routing only needs the ids. A malformed display payload must not
			// prevent later progress and completion events from reaching the card.
		}
	}
	return { messageIds, inputs };
}

function updateMessageById(
	messages: ChatMessage[],
	id: string,
	updater: (msg: ChatMessage) => ChatMessage,
): ChatMessage[] {
	let changed = false;
	const next = messages.map((msg) => {
		if (msg.id !== id) return msg;
		changed = true;
		return updater(msg);
	});
	return changed ? next : messages;
}

type SessionUsageSummary = {
	tokensIn: number;
	tokensOut: number;
	cacheReadTokens: number;
	totalCostUsd: number;
};

type TurnCostTracker = {
	streamedCostUsd: number;
};

/**
 * Read current context usage and cumulative cost from persisted chat messages.
 *
 * Each assistant message contains metrics for one model request. The latest
 * request represents current context-window pressure; summing every request's
 * input would instead measure lifetime traffic and make the ring saturate even
 * after context compaction. Cost remains a session-wide sum.
 */
function summarizeSessionUsage(
	messages: ChatMessage[],
): SessionUsageSummary | undefined {
	let tokensIn: number | undefined;
	let tokensOut: number | undefined;
	let cacheReadTokens: number | undefined;
	let totalCostUsd = 0;
	let hasCost = false;

	for (const message of messages) {
		const meta = message.meta;
		if (!meta) continue;
		if (
			typeof meta.inputTokens === "number" ||
			typeof meta.outputTokens === "number" ||
			typeof meta.cacheReadTokens === "number"
		) {
			tokensIn = meta.inputTokens ?? 0;
			tokensOut = meta.outputTokens ?? 0;
			cacheReadTokens = meta.cacheReadTokens ?? 0;
		}
		if (typeof meta.totalCost === "number") {
			totalCostUsd += meta.totalCost;
			hasCost = true;
		}
	}

	if (tokensIn === undefined && tokensOut === undefined && !hasCost) {
		return undefined;
	}
	return {
		tokensIn: tokensIn ?? 0,
		tokensOut: tokensOut ?? 0,
		cacheReadTokens: cacheReadTokens ?? 0,
		totalCostUsd,
	};
}

// ---------------------------------------------------------------------------
// Core log dispatcher — avoids repeated if/else chains
// ---------------------------------------------------------------------------

const LOG_DISPATCH: Record<string, typeof console.info> = {
	error: console.error,
	warn: console.warn,
	debug: console.debug,
};

// Core streams a steady flow of info/debug log chunks during a session.
// Serializing them through the console on the streaming hot path costs real
// CPU (DevTools keeps every entry alive), so anything below warn is dropped
// unless the user opts in via `localStorage.setItem("cline:debug-logs", "1")`.
let verboseCoreLogs: boolean | undefined;

function shouldLogVerboseCoreLogs(): boolean {
	if (verboseCoreLogs === undefined) {
		try {
			verboseCoreLogs = window.localStorage.getItem("cline:debug-logs") === "1";
		} catch {
			verboseCoreLogs = false;
		}
	}
	return verboseCoreLogs;
}

function dispatchCoreLog(chunk: string): void {
	let parsed: CoreLogChunk | undefined;
	try {
		parsed = JSON.parse(chunk) as CoreLogChunk;
	} catch {
		if (shouldLogVerboseCoreLogs()) console.info("[core]", chunk);
		return;
	}
	const level = parsed.level?.trim().toLowerCase() || "info";
	if (level !== "error" && level !== "warn" && !shouldLogVerboseCoreLogs()) {
		return;
	}
	const message = parsed.message?.trim() || chunk;
	(LOG_DISPATCH[level] ?? console.info)("[core]", message, parsed.metadata);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useChatSession() {
	const [sessionId, setSessionId] = useState<string | null>(null);
	const [status, setStatus] = useState<ChatSessionStatus>("idle");
	const [isHydratingSession, setIsHydratingSession] = useState(false);
	const [config, setConfig] = useState<ChatSessionConfig>(getInitialChatConfig);
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [rawTranscript, setRawTranscript] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [toolCalls, setToolCalls] = useState(0);
	const [tokensIn, setTokensIn] = useState(0);
	const [tokensOut, setTokensOut] = useState(0);
	const [cacheReadTokens, setCacheReadTokens] = useState(0);
	const [totalCostUsd, setTotalCostUsd] = useState(0);
	const [fileDiffs, setFileDiffs] = useState<SessionFileDiff[]>([]);
	const [diffSummary, setDiffSummary] =
		useState<SessionDiffSummary>(EMPTY_DIFF_SUMMARY);
	const [activeAssistantMessageId, setActiveAssistantMessageId] = useState<
		string | null
	>(null);
	const [hydratedHistorySessionId, setHydratedHistorySessionId] = useState<
		string | null
	>(null);
	const [pendingToolApprovals, setPendingToolApprovals] = useState<
		ToolApprovalRequestItem[]
	>([]);
	const [pendingAskQuestions, setPendingAskQuestions] = useState<
		AskQuestionRequestItem[]
	>([]);
	const [promptsInQueue, setPromptsInQueue] = useState<PromptInQueue[]>([]);
	const messagesRef = useRef<ChatMessage[]>([]);
	const promptsInQueueRef = useRef<PromptInQueue[]>([]);
	const liveToolMessageIdsRef = useRef<Record<string, string>>({});
	const pendingToolOutputRef = useRef(new Map<string, PendingToolOutput>());
	// Optimistic user bubbles whose prompt is still in flight, by message id.
	// A chat_queued_prompt_start event may only re-key one of these — never a
	// same-content message left over from an earlier turn (see the handler).
	const outstandingOptimisticUserIdsRef = useRef<Set<string>>(new Set());
	// Which optimistic bubble each queued user-message id re-keyed. The re-key
	// updater consumes the outstanding set on its first run, so StrictMode's
	// double-invoked updater needs this memo to reach the same result on its
	// re-run instead of appending a duplicate bubble.
	const rekeyedOptimisticIdByMessageIdRef = useRef<Record<string, string>>({});
	const liveToolInputsRef = useRef<Record<string, unknown>>({});
	const activeSessionIdRef = useRef<string | null>(null);
	const activeAssistantMessageIdRef = useRef<string | null>(null);
	const lastStreamIndexBySessionRef = useRef<Record<string, number>>({});
	const abortedRef = useRef(false);
	const abortFallbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const hydrationRequestIdRef = useRef(0);
	const workspaceSelectionRequestRef = useRef(0);
	const sessionStartPromiseRef = useRef<Promise<string> | null>(null);
	const promptDispatchTailRef = useRef<Promise<void>>(Promise.resolve());
	const activePromptSubmissionsRef = useRef(0);
	const activeTurnCostTrackerRef = useRef<TurnCostTracker | null>(null);
	const unpersistedCostUsdRef = useRef(0);
	const lastPersistedCostUsdRef = useRef(0);
	// Bumped whenever a new turn begins; lets async queue checks detect that
	// their result is stale because another turn already started.
	const turnEpochRef = useRef(0);
	// Epoch at which the current turn reached a terminal status. Hub-projected
	// chat_session_status events are asynchronous and a stale "running" can
	// trail chat_done; when no new turn has started since the turn settled
	// (epoch unchanged), such a "running" must not reopen the turn.
	const turnSettledEpochRef = useRef(-1);
	// Last error-level core log per session, used to explain failed turns.
	const lastCoreErrorBySessionRef = useRef<Record<string, string>>({});
	const [chatTransportState, setChatTransportState] =
		useState<ChatTransportState>(desktopClient.getTransportState());
	const [chatTransportError, setChatTransportError] = useState<string | null>(
		desktopClient.getTransportError(),
	);
	const persistedUsage = useMemo(
		() =>
			sessionId
				? summarizeSessionUsage(
						messages.filter((message) => message.sessionId === sessionId),
					)
				: undefined,
		[messages, sessionId],
	);
	const persistedTokensIn = persistedUsage?.tokensIn;
	const persistedTokensOut = persistedUsage?.tokensOut;
	const persistedCacheReadTokens = persistedUsage?.cacheReadTokens;
	const persistedTotalCostUsd = persistedUsage?.totalCostUsd;
	// ---- Ref syncs ----

	useEffect(() => {
		activeSessionIdRef.current = sessionId;
	}, [sessionId]);
	useEffect(() => {
		activeAssistantMessageIdRef.current = activeAssistantMessageId;
	}, [activeAssistantMessageId]);
	useEffect(() => {
		messagesRef.current = messages;
	}, [messages]);
	useEffect(() => {
		if (
			persistedTokensIn === undefined ||
			persistedTokensOut === undefined ||
			persistedTotalCostUsd === undefined
		) {
			return;
		}
		setTokensIn(persistedTokensIn);
		setTokensOut(persistedTokensOut);
		setCacheReadTokens(persistedCacheReadTokens ?? 0);
		// Move newly persisted spend out of the live ledger. Multiple queued turns
		// may finish before their message metadata is hydrated, so this ledger is
		// session-wide rather than tied only to the currently active turn.
		const newlyPersistedCostUsd = Math.max(
			0,
			persistedTotalCostUsd - lastPersistedCostUsdRef.current,
		);
		unpersistedCostUsdRef.current = Math.max(
			0,
			unpersistedCostUsdRef.current - newlyPersistedCostUsd,
		);
		lastPersistedCostUsdRef.current = persistedTotalCostUsd;
		setTotalCostUsd(persistedTotalCostUsd + unpersistedCostUsdRef.current);
	}, [
		persistedTokensIn,
		persistedTokensOut,
		persistedCacheReadTokens,
		persistedTotalCostUsd,
	]);
	useEffect(() => {
		promptsInQueueRef.current = promptsInQueue;
	}, [promptsInQueue]);

	const setWorkspacePath = useCallback((workspacePath: string): void => {
		workspaceSelectionRequestRef.current += 1;
		const normalized = workspacePath.trim();
		setConfig((previous) => ({
			...previous,
			workspaceRoot: normalized,
			cwd: normalized,
		}));
	}, []);

	// ---- Shared state reset helpers ----

	const clearLiveToolRefs = useCallback(() => {
		liveToolMessageIdsRef.current = {};
		liveToolInputsRef.current = {};
		pendingToolOutputRef.current = new Map();
	}, []);

	const resetStreamDedupe = useCallback((targetSessionId?: string | null) => {
		if (targetSessionId) {
			delete lastStreamIndexBySessionRef.current[targetSessionId];
			return;
		}
		lastStreamIndexBySessionRef.current = {};
	}, []);

	const clearAbortFallbackTimeout = useCallback(() => {
		if (abortFallbackTimeoutRef.current) {
			clearTimeout(abortFallbackTimeoutRef.current);
			abortFallbackTimeoutRef.current = null;
		}
	}, []);

	const resetCounters = useCallback(() => {
		activeTurnCostTrackerRef.current = null;
		unpersistedCostUsdRef.current = 0;
		lastPersistedCostUsdRef.current = 0;
		setToolCalls(0);
		setTokensIn(0);
		setTokensOut(0);
		setCacheReadTokens(0);
		setTotalCostUsd(0);
		setFileDiffs([]);
		setDiffSummary(EMPTY_DIFF_SUMMARY);
	}, []);

	const setErrorState = useCallback(
		(msg: string, sid: string | null = null) => {
			outstandingOptimisticUserIdsRef.current.clear();
			rekeyedOptimisticIdByMessageIdRef.current = {};
			setError(msg);
			setStatus("error");
			setMessages((prev) =>
				sliceMessages([...prev, makeErrorChatMessage(sid, msg)]),
			);
		},
		[],
	);

	// Surfaces a failed turn in the transcript. Some turns (for example the
	// first prompt of a fresh session, which the runtime consumes from its
	// queue) never resolve through the send() RPC, so without this the app
	// fails silently: the user message sits alone with no response and no
	// explanation. Skips appending when an error for this turn is already
	// visible so the RPC path and the chat_done stream never double-report.
	const appendTurnFailureMessage = useCallback(
		(sid: string, detail: string) => {
			const description =
				detail.trim() || lastCoreErrorBySessionRef.current[sid]?.trim() || "";
			// Deliberately avoids matching a bare "token": provider failures like
			// "maximum context tokens exceeded" or rate-limit messages are not
			// credential problems and must not point users at Settings → Models.
			const looksCredentialRelated =
				!description ||
				/unauthorized|401|403|forbidden|api key|credential|authentication|sign in|auth token|access token|invalid token|expired token|token expired/i.test(
					description,
				);
			const content = [
				description
					? `The run failed: ${description}`
					: "The run failed before a response was produced.",
				looksCredentialRelated
					? "Check your model connection in Settings → Models (or sign in with Cline), then try again."
					: "",
			]
				.filter(Boolean)
				.join(" ");
			setMessages((prev) => {
				const sessionMessages = prev.filter(
					(message) => message.sessionId === sid,
				);
				const last = sessionMessages[sessionMessages.length - 1];
				if (last?.role === "error") {
					return prev;
				}
				return sliceMessages([...prev, makeErrorChatMessage(sid, content)]);
			});
			setError(content);
		},
		[],
	);

	// Persisted history never contains UI-only error bubbles, so replacing the
	// transcript with canonical messages wholesale would silently erase a
	// failure explanation appended from chat_done moments earlier. Re-append
	// the session's error messages after the canonical history — but only the
	// ones still at the tail of the transcript (explaining the most recent
	// turn). Re-pinning every historical error would resurface failures from
	// long-completed turns at the bottom, out of chronological order, on
	// every hydration.
	const applyCanonicalHistory = useCallback(
		(sid: string, historyMessages: ChatMessage[]) => {
			setMessages((prev) => {
				const sessionMessages = prev.filter(
					(message) => message.sessionId === sid,
				);
				let tailErrorStart = sessionMessages.length;
				while (
					tailErrorStart > 0 &&
					sessionMessages[tailErrorStart - 1]?.role === "error"
				) {
					tailErrorStart -= 1;
				}
				const preservedErrors = sessionMessages.slice(tailErrorStart);
				if (preservedErrors.length === 0) {
					return historyMessages;
				}
				return sliceMessages([...historyMessages, ...preservedErrors]);
			});
		},
		[],
	);

	// Finalizes a turn that settled through the event stream rather than a
	// blocking send() RPC. Queued turns (including the first prompt of a fresh
	// session, which the runtime routes through its queue) resolve their send()
	// RPC early with { queued: true }, so nothing else clears the streaming
	// shimmer or reconciles the live-streamed content against the persisted
	// transcript — without this, a turn whose deltas were incomplete stays
	// visually "streaming" forever and only heals when a later non-queued send
	// happens to rehydrate history.
	const turnEndReconcileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const finalizeSettledTurn = useCallback(
		(sid: string) => {
			if (activePromptSubmissionsRef.current > 0) {
				// A blocking send() RPC is still in flight for this turn: its
				// completion path applies the result text, rehydrates canonical
				// history, and clears the streaming id itself. Clearing the id
				// here would make that path mint a duplicate assistant bubble.
				return;
			}
			activeAssistantMessageIdRef.current = null;
			setActiveAssistantMessageId(null);
			const epoch = turnEpochRef.current;
			if (turnEndReconcileTimerRef.current !== null) {
				clearTimeout(turnEndReconcileTimerRef.current);
			}
			turnEndReconcileTimerRef.current = setTimeout(() => {
				turnEndReconcileTimerRef.current = null;
				void desktopClient
					.invoke<ChatMessage[]>("read_session_messages", {
						sessionId: sid,
						maxMessages: MAX_MESSAGES,
					})
					.then((historyMessages) => {
						if (
							activeSessionIdRef.current !== sid ||
							turnEpochRef.current !== epoch ||
							activePromptSubmissionsRef.current > 0
						) {
							// A new turn started while the read was in flight; its
							// own lifecycle owns the transcript from here on.
							return;
						}
						if (
							historyMessages.length === 0 ||
							!historyMessages.some((message) => message.role === "assistant")
						) {
							// Persistence has not caught up: keep the live state
							// rather than wiping it with an incomplete transcript.
							return;
						}
						applyCanonicalHistory(sid, historyMessages);
					})
					.catch(() => {
						// Keep optimistic state if the hydration read fails.
					});
			}, TURN_END_RECONCILE_DELAY_MS);
		},
		[applyCanonicalHistory],
	);

	useEffect(() => {
		return () => {
			if (turnEndReconcileTimerRef.current !== null) {
				clearTimeout(turnEndReconcileTimerRef.current);
			}
		};
	}, []);

	// ---- Data fetching ----

	const postSession = useCallback(async (body: Record<string, unknown>) => {
		const request = { request: body };
		if (body.action === "send") {
			return await desktopClient.invoke<ChatSessionCommandResponse>(
				"chat_session_command",
				request,
				{ timeoutMs: null },
			);
		}
		return await desktopClient.invoke<ChatSessionCommandResponse>(
			"chat_session_command",
			request,
		);
	}, []);

	// Confirms a "still running because prompts are queued" status against the
	// server. The local queue snapshot can be stale when the dequeue
	// notification races the turn-completion event, which would otherwise
	// leave the composer stuck on "Agent is working..." forever.
	const verifyQueueStillBusy = useCallback(
		(sid: string) => {
			const epoch = turnEpochRef.current;
			void postSession({ action: "pending_prompts", sessionId: sid })
				.then((payload) => {
					if (
						activeSessionIdRef.current !== sid ||
						turnEpochRef.current !== epoch
					) {
						return;
					}
					const items = Array.isArray(payload.promptsInQueue)
						? payload.promptsInQueue
						: [];
					setPromptsInQueue(items);
					if (items.length === 0) {
						turnSettledEpochRef.current = turnEpochRef.current;
						setStatus((current) =>
							current === "running" ? "completed" : current,
						);
						finalizeSettledTurn(sid);
					}
				})
				.catch(() => {
					// Keep the last known state on transient transport failures.
				});
		},
		[finalizeSettledTurn, postSession],
	);

	const refreshPromptsInQueue = useCallback(
		async (targetSessionId: string | null) => {
			if (!targetSessionId) {
				setPromptsInQueue([]);
				return;
			}
			try {
				const payload = await postSession({
					action: "pending_prompts",
					sessionId: targetSessionId,
				});
				setPromptsInQueue(
					Array.isArray(payload.promptsInQueue) ? payload.promptsInQueue : [],
				);
			} catch {
				// Ignore queue refresh failures and keep the last known state.
			}
		},
		[postSession],
	);

	const applyPromptsInQueue = useCallback((value: unknown) => {
		if (!Array.isArray(value)) {
			return;
		}
		setPromptsInQueue(value as PromptInQueue[]);
	}, []);

	const sessionDiffCwd = (config.cwd || config.workspaceRoot || "").trim();
	const refreshSessionDiffSummary = useCallback(
		async (targetSessionId: string) => {
			try {
				const events = await desktopClient.invoke<ChatSessionHookEvent[]>(
					"read_session_hooks",
					{ sessionId: targetSessionId, limit: MAX_MESSAGES },
				);
				const diffState = buildSessionDiffState(events, sessionDiffCwd);
				setFileDiffs(diffState.fileDiffs);
				setDiffSummary(diffState.summary);
				setToolCalls(
					events.filter(
						(e) =>
							e.hookEventName === "tool_call" || e.hookName === "tool_call",
					).length,
				);
			} catch {
				// Ignore in non-Tauri mode.
			}
		},
		[sessionDiffCwd],
	);

	// ---- Message helpers ----

	const addMessage = useCallback((message: ChatMessage) => {
		setMessages((prev) => sliceMessages([...prev, message]));
	}, []);

	const shouldApplyStreamChunk = useCallback((payload: AgentChunkEvent) => {
		const index = payload.index;
		if (typeof index !== "number") {
			return true;
		}
		const previous = lastStreamIndexBySessionRef.current[payload.sessionId];
		if (previous !== undefined && index <= previous) {
			return false;
		}
		lastStreamIndexBySessionRef.current[payload.sessionId] = index;
		return true;
	}, []);

	const materializeToolMessagesFromResult = useCallback(
		(options: {
			sessionId: string;
			turnStartedAt: number;
			toolCalls: NonNullable<ChatApiResult["toolCalls"]>;
		}) => {
			const { sessionId: targetSessionId, turnStartedAt, toolCalls } = options;
			if (toolCalls.length === 0) return;
			setMessages((prev) => {
				const hasLive = prev.some(
					(m) =>
						m.sessionId === targetSessionId &&
						m.role === "tool" &&
						m.createdAt >= turnStartedAt,
				);
				if (hasLive) return prev;

				const next = [...prev];
				for (const call of toolCalls) {
					next.push({
						id: makeId("tool"),
						sessionId: targetSessionId,
						role: "tool",
						content: JSON.stringify({
							toolName: call.name,
							input: call.input,
							result: call.error ? call.error : call.output,
							isError: Boolean(call.error),
						}),
						createdAt: turnStartedAt + next.length,
						meta: { toolName: call.name, hookEventName: "tool_call_end" },
					});
				}
				return sliceMessages(sortMessagesChronologically(next));
			});
		},
		[],
	);

	const appendMessageContent = useCallback((id: string, chunk: string) => {
		if (!chunk) return;
		setMessages((prev) =>
			updateMessageById(prev, id, (msg) => {
				const existing = msg.content;
				if (existing.endsWith(chunk)) return msg;
				const content = chunk.startsWith(existing)
					? chunk
					: `${existing}${chunk}`;
				return { ...msg, content };
			}),
		);
	}, []);

	const appendMessageReasoning = useCallback(
		(id: string, chunk: string, redacted = false) => {
			if (!chunk && !redacted) return;
			setMessages((prev) =>
				updateMessageById(prev, id, (msg) => {
					const reasoningChunk = chunk || (redacted ? "[redacted]" : "");
					const existing = msg.reasoning ?? "";
					if (reasoningChunk && existing.endsWith(reasoningChunk)) {
						return redacted && !msg.reasoningRedacted
							? { ...msg, reasoningRedacted: true }
							: msg;
					}
					return {
						...msg,
						reasoning: `${existing}${reasoningChunk}`,
						reasoningRedacted: msg.reasoningRedacted || redacted,
					};
				}),
			);
		},
		[],
	);

	// ---- Stream coalescing ----
	//
	// Text/reasoning deltas and command chunks can arrive rapidly, and a React commit
	// re-renders the whole conversation for every word. Deltas are buffered in
	// refs and flushed on a short timer, so streaming costs at most ~20 commits
	// per second regardless of token rate while still feeling live.

	const pendingStreamTextRef = useRef(new Map<string, string>());
	const pendingStreamReasoningRef = useRef(
		new Map<string, { text: string; redacted: boolean }>(),
	);
	const pendingStreamTranscriptRef = useRef("");
	const streamFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);

	const flushPendingStream = useCallback(() => {
		if (streamFlushTimerRef.current !== null) {
			clearTimeout(streamFlushTimerRef.current);
			streamFlushTimerRef.current = null;
		}
		const texts = pendingStreamTextRef.current;
		if (texts.size > 0) {
			pendingStreamTextRef.current = new Map();
			for (const [id, chunk] of texts) {
				appendMessageContent(id, chunk);
			}
		}
		const reasonings = pendingStreamReasoningRef.current;
		if (reasonings.size > 0) {
			pendingStreamReasoningRef.current = new Map();
			for (const [id, entry] of reasonings) {
				appendMessageReasoning(id, entry.text, entry.redacted);
			}
		}
		const toolOutputs = pendingToolOutputRef.current;
		if (toolOutputs.size > 0) {
			pendingToolOutputRef.current = new Map();
			setMessages((prev) =>
				prev.map((message) => {
					const pending = toolOutputs.get(message.id);
					if (!pending) return message;
					const merged = appendCappedCommandOutput(
						message.meta?.toolOutput ?? "",
						pending.text,
					);
					const toolOutputTruncated = Boolean(
						message.meta?.toolOutputTruncated ||
							pending.truncated ||
							merged.truncated,
					);
					const toolDetachable =
						pending.detachable ?? message.meta?.toolDetachable;
					if (
						merged.output === (message.meta?.toolOutput ?? "") &&
						toolOutputTruncated ===
							Boolean(message.meta?.toolOutputTruncated) &&
						toolDetachable === message.meta?.toolDetachable
					) {
						return message;
					}
					return {
						...message,
						meta: {
							...message.meta,
							toolOutput: merged.output,
							toolOutputTruncated,
							...(toolDetachable !== undefined ? { toolDetachable } : {}),
						},
					};
				}),
			);
		}
		const transcript = pendingStreamTranscriptRef.current;
		if (transcript) {
			pendingStreamTranscriptRef.current = "";
			setRawTranscript((prev) => `${prev}${transcript}`);
		}
	}, [appendMessageContent, appendMessageReasoning]);

	const schedulePendingStreamFlush = useCallback(() => {
		if (streamFlushTimerRef.current !== null) {
			return;
		}
		streamFlushTimerRef.current = setTimeout(() => {
			streamFlushTimerRef.current = null;
			flushPendingStream();
		}, STREAM_FLUSH_INTERVAL_MS);
	}, [flushPendingStream]);

	const discardPendingStream = useCallback(() => {
		if (streamFlushTimerRef.current !== null) {
			clearTimeout(streamFlushTimerRef.current);
			streamFlushTimerRef.current = null;
		}
		pendingStreamTextRef.current = new Map();
		pendingStreamReasoningRef.current = new Map();
		pendingToolOutputRef.current = new Map();
		pendingStreamTranscriptRef.current = "";
	}, []);

	useEffect(() => {
		return () => {
			if (streamFlushTimerRef.current !== null) {
				clearTimeout(streamFlushTimerRef.current);
			}
		};
	}, []);

	// ---- Process context ----

	const applyProcessContext = useCallback(async () => {
		const requestId = workspaceSelectionRequestRef.current;
		try {
			const ctx = await desktopClient.invoke<ProcessContext>(
				"get_process_context",
			);
			if (ctx.homeDir) {
				registerHostHomeDirectory(ctx.homeDir);
			}
			const rememberedWorkspace =
				readWorkspaceSelectionFromWindow().lastWorkspace;
			const validation = rememberedWorkspace
				? await desktopClient
						.invoke<{ valid?: boolean }>("validate_workspace_directory", {
							path: rememberedWorkspace,
						})
						.catch(() => ({ valid: false }))
				: { valid: false };
			if (requestId !== workspaceSelectionRequestRef.current) {
				return;
			}
			setConfig((prev) => {
				const currentWorkspace = (prev.workspaceRoot || prev.cwd || "").trim();
				const selectionChangedWhileLoading = Boolean(
					currentWorkspace &&
						normalizeWorkspacePath(currentWorkspace) !==
							normalizeWorkspacePath(rememberedWorkspace),
				);
				const workspace = selectionChangedWhileLoading
					? currentWorkspace
					: validation.valid === true
						? rememberedWorkspace
						: ctx.workspaceRoot || ctx.cwd;
				return {
					...prev,
					workspaceRoot: workspace,
					cwd: workspace,
				};
			});
		} catch {
			// Ignore in non-Tauri mode.
		}
	}, []);

	useEffect(() => {
		void applyProcessContext();
	}, [applyProcessContext]);

	// ---- Diff / approval effects ----

	useEffect(() => {
		if (!sessionId) {
			setFileDiffs([]);
			setDiffSummary(EMPTY_DIFF_SUMMARY);
			setPendingToolApprovals([]);
			setPendingAskQuestions([]);
			setPromptsInQueue([]);
			return;
		}
		void refreshSessionDiffSummary(sessionId);
		void refreshPromptsInQueue(sessionId);
	}, [refreshPromptsInQueue, refreshSessionDiffSummary, sessionId]);

	// Fallback for sessions with no tool events in the hook log (e.g. sessions
	// recorded before tool_call/tool_result hook logging existed): rebuild the
	// diff state from the tool messages themselves.
	useEffect(() => {
		if (!sessionId || fileDiffs.length > 0) {
			return;
		}
		const events: SessionHookEvent[] = [];
		for (const message of messages) {
			if (message.sessionId !== sessionId || message.role !== "tool") {
				continue;
			}
			let payload: {
				toolName?: string;
				input?: unknown;
				result?: unknown;
				isError?: boolean;
			} | null = null;
			try {
				payload = JSON.parse(message.content);
			} catch {
				continue;
			}
			if (!payload?.toolName || payload.result == null || payload.isError) {
				continue;
			}
			events.push({
				hookName: "tool_result",
				toolName: payload.toolName,
				toolInput: payload.input,
				toolOutput: payload.result,
			});
		}
		if (events.length === 0) {
			return;
		}
		const diffState = buildSessionDiffState(events, sessionDiffCwd);
		if (diffState.fileDiffs.length === 0) {
			return;
		}
		setFileDiffs(diffState.fileDiffs);
		setDiffSummary(diffState.summary);
	}, [sessionId, messages, fileDiffs.length, sessionDiffCwd]);

	useEffect(() => {
		const activeSessionId = sessionId;
		setPendingToolApprovals([]);
		setPendingAskQuestions([]);
		if (!activeSessionId) {
			return;
		}
		let cancelled = false;

		void desktopClient
			.invoke<ToolApprovalRequestItem[]>("poll_tool_approvals", {
				sessionId: activeSessionId,
				limit: 20,
			})
			.then((pending) => {
				if (!cancelled) {
					setPendingToolApprovals(pending);
				}
			})
			.catch(() => {});

		void desktopClient
			.invoke<AskQuestionRequestItem[]>("poll_ask_questions", {
				sessionId: activeSessionId,
			})
			.then((pending) => {
				if (!cancelled) {
					setPendingAskQuestions(pending);
				}
			})
			.catch(() => {});

		const unsubscribe = desktopClient.subscribe(
			"tool_approval_state",
			(payload) => {
				if (!payload || typeof payload !== "object") return;
				const record = payload as {
					sessionId?: string;
					items?: ToolApprovalRequestItem[];
				};
				if (record.sessionId !== activeSessionId) return;
				setPendingToolApprovals(
					Array.isArray(record.items) ? record.items : [],
				);
			},
		);

		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, [sessionId]);

	useEffect(() => {
		return desktopClient.subscribe("ask_question_requested", (payload) => {
			if (!payload || typeof payload !== "object") return;
			const item = payload as AskQuestionRequestItem;
			if (
				item.sessionId !== activeSessionIdRef.current ||
				!item.requestId ||
				!item.question ||
				!Array.isArray(item.options)
			) {
				return;
			}
			setPendingAskQuestions((prev) => {
				if (prev.some((existing) => existing.requestId === item.requestId)) {
					return prev;
				}
				return [...prev, item];
			});
		});
	}, []);

	useEffect(() => {
		return desktopClient.subscribe("ask_question_answered", (payload) => {
			if (!payload || typeof payload !== "object") return;
			const requestId = String(
				(payload as { requestId?: unknown }).requestId ?? "",
			).trim();
			if (!requestId) return;
			setPendingAskQuestions((prev) =>
				prev.filter((item) => item.requestId !== requestId),
			);
		});
	}, []);

	useEffect(() => {
		return desktopClient.subscribe("ask_question_cancelled", (payload) => {
			if (!payload || typeof payload !== "object") return;
			const requestId = String(
				(payload as { requestId?: unknown }).requestId ?? "",
			).trim();
			if (!requestId) return;
			setPendingAskQuestions((prev) =>
				prev.filter((item) => item.requestId !== requestId),
			);
		});
	}, []);

	useEffect(() => {
		return desktopClient.subscribe("prompts_in_queue_state", (payload) => {
			if (!payload || typeof payload !== "object") return;
			const record = payload as {
				sessionId?: string;
				items?: PromptInQueue[];
			};
			if (record.sessionId !== activeSessionIdRef.current) return;
			setPromptsInQueue(Array.isArray(record.items) ? record.items : []);
		});
	}, []);

	// ---- Incoming chunk handler ----

	const handleIncomingChunk = useCallback(
		(payload: AgentChunkEvent) => {
			if (!RELEVANT_STREAMS.has(payload.stream)) return;
			if (!shouldApplyStreamChunk(payload)) return;

			const listeningSessionId = activeSessionIdRef.current;
			if (!listeningSessionId || payload.sessionId !== listeningSessionId) {
				return;
			}
			if (abortedRef.current) {
				return;
			}

			// --- Text stream (buffered) ---
			if (payload.stream === "chat_text") {
				let assistantId = activeAssistantMessageIdRef.current;
				if (!assistantId) {
					assistantId = makeId("assistant");
					addMessage({
						id: assistantId,
						sessionId: listeningSessionId,
						role: "assistant",
						content: "",
						createdAt: chunkCreatedAt(payload),
					});
					activeAssistantMessageIdRef.current = assistantId;
					setActiveAssistantMessageId(assistantId);
				}
				const pending = pendingStreamTextRef.current;
				pending.set(
					assistantId,
					(pending.get(assistantId) ?? "") + payload.chunk,
				);
				pendingStreamTranscriptRef.current += payload.chunk;
				schedulePendingStreamFlush();
				return;
			}

			if (payload.stream === "chat_reasoning") {
				let assistantId = activeAssistantMessageIdRef.current;
				if (!assistantId) {
					assistantId = makeId("assistant");
					addMessage({
						id: assistantId,
						sessionId: listeningSessionId,
						role: "assistant",
						content: "",
						createdAt: chunkCreatedAt(payload),
					});
					activeAssistantMessageIdRef.current = assistantId;
					setActiveAssistantMessageId(assistantId);
				}
				let parsed: ReasoningDeltaEvent = {};
				try {
					parsed = JSON.parse(payload.chunk) as ReasoningDeltaEvent;
				} catch {
					parsed = { text: payload.chunk };
				}
				if (parsed.text || parsed.redacted === true) {
					const pending = pendingStreamReasoningRef.current;
					const existing = pending.get(assistantId);
					pending.set(assistantId, {
						text: `${existing?.text ?? ""}${parsed.text ?? ""}`,
						redacted: (existing?.redacted ?? false) || parsed.redacted === true,
					});
					schedulePendingStreamFlush();
				}
				return;
			}

			if (payload.stream === "chat_tool_call_update") {
				let parsed: ToolCallUpdateEvent = {};
				try {
					parsed = JSON.parse(payload.chunk) as ToolCallUpdateEvent;
				} catch {
					return;
				}
				const toolCallId = parsed.toolCallId;
				const messageId = toolCallId
					? liveToolMessageIdsRef.current[toolCallId]
					: undefined;
				if (!messageId) return;
				const update =
					parsed.update &&
					typeof parsed.update === "object" &&
					!Array.isArray(parsed.update)
						? (parsed.update as Record<string, unknown>)
						: undefined;
				if (!update) return;
				const stream = update.stream;
				const chunk =
					(stream === "stdout" || stream === "stderr") &&
					typeof update.chunk === "string"
						? update.chunk
						: "";
				const detachable =
					typeof update.detachable === "boolean"
						? update.detachable
						: undefined;
				const sourceTruncated = update.truncated === true;
				if (!chunk && detachable === undefined && !sourceTruncated) return;
				const pending = pendingToolOutputRef.current;
				const existing = pending.get(messageId);
				const appended = appendCappedCommandOutput(existing?.text ?? "", chunk);
				pending.set(messageId, {
					text: appended.output,
					truncated: Boolean(
						existing?.truncated || appended.truncated || sourceTruncated,
					),
					detachable: detachable ?? existing?.detachable,
				});
				schedulePendingStreamFlush();
				return;
			}

			// Any non-delta event (tool calls, prompt starts, done markers) must
			// observe fully applied text, so drain the buffers first.
			flushPendingStream();

			if (payload.stream === "chat_media") {
				let parsed: unknown;
				try {
					parsed = JSON.parse(payload.chunk);
				} catch {
					return;
				}
				const media = ChatMessageMediaSchema.safeParse(parsed);
				if (!media.success) {
					console.warn(
						"[desktop:chat] Ignoring invalid generated media",
						media.error.flatten(),
					);
					return;
				}
				setMessages((prev) => {
					if (
						prev.some((message) =>
							message.media?.some((item) => item.id === media.data.id),
						)
					) {
						return prev;
					}
					return sliceMessages([
						...prev,
						{
							id: `media_${media.data.id}`,
							sessionId: listeningSessionId,
							role: "assistant",
							content: "",
							media: [media.data],
							createdAt: chunkCreatedAt(payload),
						},
					]);
				});
				activeAssistantMessageIdRef.current = null;
				setActiveAssistantMessageId(null);
				return;
			}

			if (payload.stream === "chat_queued_prompt_start") {
				activeTurnCostTrackerRef.current = { streamedCostUsd: 0 };
				turnEpochRef.current += 1;
				// A new turn starts now: an error remembered from an earlier turn
				// must not be attributed to this one if it fails without detail.
				delete lastCoreErrorBySessionRef.current[listeningSessionId];
				let parsed: {
					promptId?: string;
					prompt?: string;
					attachmentCount?: number;
					userImages?: string[];
				} = {};
				try {
					parsed = JSON.parse(payload.chunk) as {
						promptId?: string;
						prompt?: string;
						attachmentCount?: number;
						userImages?: string[];
					};
				} catch {
					parsed = { prompt: payload.chunk };
				}
				const prompt = parsed.prompt?.trim() ?? "";
				const attachmentCount =
					typeof parsed.attachmentCount === "number"
						? parsed.attachmentCount
						: 0;
				const userImages = Array.isArray(parsed.userImages)
					? parsed.userImages.filter(
							(image): image is string => typeof image === "string",
						)
					: [];
				const attachedFileCount = Math.max(
					0,
					attachmentCount - userImages.length,
				);
				const userLabel =
					attachedFileCount > 0
						? `${prompt}${prompt.length > 0 ? "\n\n" : ""}[attached ${attachedFileCount} file${attachedFileCount === 1 ? "" : "s"}]`
						: prompt;
				const promptId = parsed.promptId?.trim();
				activeAssistantMessageIdRef.current = null;
				setActiveAssistantMessageId(null);
				clearLiveToolRefs();
				setStatus("running");
				// The prompt just left the queue: drop it from the local snapshot
				// immediately. Waiting for the next server snapshot leaves a
				// window where turn completion still sees a stale busy queue and
				// keeps the composer on "Agent is working..." forever.
				setPromptsInQueue((prev) => {
					if (prev.length === 0) {
						return prev;
					}
					let index = promptId
						? prev.findIndex((item) => item.id === promptId)
						: -1;
					if (index === -1) {
						index = prev.findIndex(
							(item) => item.prompt === userLabel || item.prompt === prompt,
						);
					}
					if (index === -1) {
						return prev;
					}
					const next = [...prev.slice(0, index), ...prev.slice(index + 1)];
					promptsInQueueRef.current = next;
					return next;
				});
				if (userLabel || userImages.length > 0) {
					// Computed outside the updater: makeId() inside would mint a
					// different id on each StrictMode re-invocation.
					const userMessageId = promptId
						? `queued_user_${promptId}`
						: makeId("user");
					setMessages((prev) => {
						if (prev.some((message) => message.id === userMessageId)) {
							return prev;
						}
						const images = toChatMessageImages(userImages, userMessageId);
						// A prompt dispatched while the session was idle already has
						// an optimistic bubble from the send path; when the runtime
						// routes that prompt through its queue, this event describes
						// the same prompt. Re-key the optimistic bubble instead of
						// rendering the message a second time. Only bubbles whose
						// prompt is still in flight are eligible — a same-content
						// message left over from an earlier (e.g. cancelled) turn
						// must stay distinct from the new submission.
						// The first run of this updater consumes the outstanding id, so
						// a StrictMode re-run against the same `prev` must recognize the
						// bubble it already re-keyed rather than fall through to append.
						const priorRekeyedId =
							rekeyedOptimisticIdByMessageIdRef.current[userMessageId];
						for (let i = prev.length - 1; i >= 0; i--) {
							const candidate = prev[i];
							if (candidate.role !== "user") {
								break;
							}
							if (
								candidate.content === userLabel &&
								(outstandingOptimisticUserIdsRef.current.has(candidate.id) ||
									candidate.id === priorRekeyedId)
							) {
								outstandingOptimisticUserIdsRef.current.delete(candidate.id);
								rekeyedOptimisticIdByMessageIdRef.current[userMessageId] =
									candidate.id;
								const next = [...prev];
								next[i] = {
									...candidate,
									id: userMessageId,
									images: images.length > 0 ? images : candidate.images,
								};
								return sliceMessages(next);
							}
						}
						return sliceMessages([
							...prev,
							{
								id: userMessageId,
								sessionId: listeningSessionId,
								role: "user",
								content: userLabel,
								images: images.length > 0 ? images : undefined,
								createdAt: chunkCreatedAt(payload),
							},
						]);
					});
				}
				return;
			}

			// --- Core log ---
			if (payload.stream === "chat_core_log") {
				dispatchCoreLog(payload.chunk);
				// Remember the latest error so a failed turn can explain itself:
				// the runtime reports the underlying cause (e.g. an auth failure)
				// here rather than on the turn-completion event.
				try {
					const parsed = JSON.parse(payload.chunk) as CoreLogChunk;
					if (
						parsed.level?.trim().toLowerCase() === "error" &&
						parsed.message?.trim()
					) {
						lastCoreErrorBySessionRef.current[payload.sessionId] =
							parsed.message.trim();
					}
				} catch {
					// Unstructured logs carry no level; nothing to remember.
				}
				return;
			}

			if (payload.stream === "chat_usage") {
				let usage: ChatUsageEvent;
				try {
					usage = JSON.parse(payload.chunk) as ChatUsageEvent;
				} catch {
					return;
				}
				if (typeof usage.inputTokens === "number") {
					setTokensIn(usage.inputTokens);
				}
				if (typeof usage.outputTokens === "number") {
					setTokensOut(usage.outputTokens);
				}
				if (typeof usage.cacheReadTokens === "number") {
					setCacheReadTokens(usage.cacheReadTokens);
				}
				const cost = usage.cost;
				if (typeof cost === "number") {
					const tracker = activeTurnCostTrackerRef.current ?? {
						streamedCostUsd: 0,
					};
					tracker.streamedCostUsd += cost;
					activeTurnCostTrackerRef.current = tracker;
					unpersistedCostUsdRef.current += cost;
					setTotalCostUsd((previous) => previous + cost);
				}
				return;
			}

			if (payload.stream === "chat_done") {
				// The turn is over: any optimistic bubble still registered was
				// consumed by a direct send and must not be re-keyed by a later
				// queued prompt that happens to repeat the same text. Clear
				// inside an updater so that when this event lands in the same
				// batch as its turn's chat_queued_prompt_start (fast-failing
				// turns), the re-key updater queued by that event still sees the
				// registered bubble and runs first. (Idempotent, so safe under
				// StrictMode's double-invoked updaters.)
				setMessages((prev) => {
					outstandingOptimisticUserIdsRef.current.clear();
					return prev;
				});
				clearLiveToolRefs();
				// Prompts that the runtime consumed from the queue (for example the
				// first prompt of a fresh session, which is queued while the
				// interactive loop is still starting) never resolve through the
				// send() RPC, so this stream event is the only turn-completion
				// signal. Without it the composer stays on "Agent is working..."
				// forever.
				let doneReason = "";
				let doneText = "";
				try {
					const parsed = JSON.parse(payload.chunk) as {
						reason?: string;
						text?: string;
					};
					doneReason = parsed.reason?.trim() ?? "";
					doneText = typeof parsed.text === "string" ? parsed.text.trim() : "";
				} catch {
					// Missing reason still means the turn ended.
				}
				if (doneReason === "error") {
					appendTurnFailureMessage(listeningSessionId, doneText);
				}
				// The remembered core error belongs to the turn that just ended.
				// Turn-start events also clear it, but they can be lost across a
				// transport interruption (websocket events are not replayed), so
				// clearing on turn end too keeps a stale error from ever being
				// attributed to a later turn's detail-less failure.
				delete lastCoreErrorBySessionRef.current[listeningSessionId];
				const nextStatus: ChatSessionStatus =
					doneReason === "aborted"
						? "cancelled"
						: doneReason === "error"
							? "failed"
							: // Prompts still waiting in the queue mean the session is
								// only between turns, not done: keep the composer in the
								// busy state until the queue drains.
								promptsInQueueRef.current.length > 0
								? "running"
								: "completed";
				setStatus(nextStatus);
				if (nextStatus === "running") {
					verifyQueueStillBusy(listeningSessionId);
				} else {
					turnSettledEpochRef.current = turnEpochRef.current;
					finalizeSettledTurn(listeningSessionId);
				}
				return;
			}

			// --- Tool call start ---
			if (payload.stream === "chat_tool_call_start") {
				let parsed: ToolCallStartEvent = {};
				try {
					parsed = JSON.parse(payload.chunk) as ToolCallStartEvent;
				} catch {
					return;
				}
				const toolName = parsed.toolName ?? "unknown_tool";
				const toolCallId = parsed.toolCallId ?? makeId("tool_call");
				const messageId = makeId("tool");
				liveToolMessageIdsRef.current[toolCallId] = messageId;
				liveToolInputsRef.current[toolCallId] = parsed.input;
				// Reset so text after this tool call gets a fresh assistant message
				activeAssistantMessageIdRef.current = null;
				setActiveAssistantMessageId(null);
				addMessage({
					id: messageId,
					sessionId: listeningSessionId,
					role: "tool",
					content: buildToolPayloadString({
						toolName,
						input: parsed.input,
						output: null,
					}),
					createdAt: chunkCreatedAt(payload),
					meta: {
						toolName,
						toolCallId,
						hookEventName: "tool_call_start",
					},
				});
				setToolCalls((prev) => prev + 1);
				return;
			}

			// --- Tool call end ---
			let parsed: ToolCallEndEvent = {};
			try {
				parsed = JSON.parse(payload.chunk) as ToolCallEndEvent;
			} catch {
				return;
			}
			const toolName = parsed.toolName ?? "unknown_tool";
			const toolCallId = parsed.toolCallId;
			const messageId = toolCallId
				? liveToolMessageIdsRef.current[toolCallId]
				: undefined;
			const toolInput =
				parsed.input ??
				(toolCallId ? liveToolInputsRef.current[toolCallId] : undefined);
			const toolPayload = buildToolPayloadString({
				toolName,
				input: toolInput,
				output: parsed.output,
				error: parsed.error,
			});
			if (toolCallId) {
				delete liveToolMessageIdsRef.current[toolCallId];
				delete liveToolInputsRef.current[toolCallId];
			}
			if (messageId) {
				// Single setMessages call replaces content + updates meta together.
				setMessages((prev) =>
					updateMessageById(prev, messageId, (msg) => ({
						...msg,
						content: toolPayload,
						meta: {
							...msg.meta,
							toolName,
							toolCallId,
							toolDetachable: false,
							hookEventName: "tool_call_end",
						},
					})),
				);
				return;
			}
			// Ignore unmatched tool end events so stale completions from the
			// previous turn do not get rendered under a newer streaming turn.
		},
		[
			addMessage,
			appendTurnFailureMessage,
			clearLiveToolRefs,
			finalizeSettledTurn,
			flushPendingStream,
			schedulePendingStreamFlush,
			shouldApplyStreamChunk,
			verifyQueueStillBusy,
		],
	);

	// ---- Transport / event subscriptions ----

	useEffect(() => {
		const unsubscribeTransport = desktopClient.subscribeTransportState(
			(state) => {
				setChatTransportState(state);
				setChatTransportError(desktopClient.getTransportError());
			},
		);
		const unsubscribeEvents = desktopClient.subscribe(
			"chat_event",
			(payload) => {
				if (payload && typeof payload === "object") {
					handleIncomingChunk(payload as AgentChunkEvent);
				}
			},
		);
		return () => {
			unsubscribeTransport();
			unsubscribeEvents();
		};
	}, [handleIncomingChunk]);

	useEffect(() => {
		const unsubscribeStatus = desktopClient.subscribe(
			"chat_session_status",
			(payload) => {
				if (!payload || typeof payload !== "object") {
					return;
				}
				const record = payload as {
					sessionId?: string;
					status?: string;
				};
				const targetSessionId = record.sessionId?.trim();
				if (
					!targetSessionId ||
					targetSessionId !== activeSessionIdRef.current
				) {
					return;
				}
				const nextStatus = record.status?.trim();
				if (!nextStatus) {
					return;
				}
				// Status events are projected asynchronously from the hub's
				// session record and can deliver a stale "running" after the
				// stream's chat_done already settled the turn. A genuinely new
				// turn always bumps the epoch (chat_queued_prompt_start) or
				// goes through the local submit paths, so while the epoch still
				// equals the settled epoch a "running" here can only be stale.
				if (
					nextStatus === "running" &&
					turnEpochRef.current === turnSettledEpochRef.current
				) {
					return;
				}
				setStatus(nextStatus as ChatSessionStatus);
			},
		);
		const unsubscribeEnded = desktopClient.subscribe(
			"chat_session_ended",
			(payload) => {
				if (!payload || typeof payload !== "object") {
					return;
				}
				const record = payload as {
					sessionId?: string;
					reason?: string;
				};
				const targetSessionId = record.sessionId?.trim();
				if (
					!targetSessionId ||
					targetSessionId !== activeSessionIdRef.current
				) {
					return;
				}
				activeAssistantMessageIdRef.current = null;
				setActiveAssistantMessageId(null);
				clearLiveToolRefs();
				turnSettledEpochRef.current = turnEpochRef.current;
				setStatus((record.reason?.trim() || "idle") as ChatSessionStatus);
				finalizeSettledTurn(targetSessionId);
			},
		);
		return () => {
			unsubscribeStatus();
			unsubscribeEnded();
		};
	}, [clearLiveToolRefs, finalizeSettledTurn]);

	// ---- Shared: start a new session via RPC ----

	const startSession = useCallback(
		async (
			validatedConfig: ChatSessionConfig,
			options: { preserveStatus?: boolean } = {},
		): Promise<string> => {
			const payload = await postSession({
				action: "start",
				config: validatedConfig,
			});
			const id = payload.sessionId;
			if (!id) throw new Error("Missing session id from server");
			const workspaceRoot =
				payload.workspaceRoot?.trim() || validatedConfig.workspaceRoot.trim();
			const cwd =
				payload.cwd?.trim() || validatedConfig.cwd?.trim() || workspaceRoot;
			if (!workspaceRoot || !cwd) {
				throw new Error("Missing resolved workspace from server");
			}
			setSessionId(id);
			// Mark idle — not running — so the first sendPrompt is not queued.
			// The status transitions to "starting"/"running" once a prompt is
			// actually dispatched.
			if (!options.preserveStatus) {
				setStatus("idle");
			}
			workspaceSelectionRequestRef.current += 1;
			setConfig({
				...validatedConfig,
				cwd,
				workspaceRoot,
			});
			setHydratedHistorySessionId(null);
			return id;
		},
		[postSession],
	);

	// ---- Actions ----

	const start = useCallback(
		async (nextConfig: ChatSessionConfig) => {
			const validation = validateConfig(nextConfig);
			if (!validation.parsed) {
				setErrorState(validation.error);
				return;
			}
			const parsed = validation.parsed;

			setError(null);
			setStatus("starting");
			setIsHydratingSession(false);
			abortedRef.current = false;
			clearAbortFallbackTimeout();
			discardPendingStream();
			setMessages([]);
			setRawTranscript("");
			resetCounters();
			setConfig(parsed);
			setHydratedHistorySessionId(null);
			setPromptsInQueue([]);

			try {
				const id = await startSession(parsed);
				addMessage({
					id: makeId("status"),
					sessionId: id,
					role: "status",
					content: `Session started: ${id}`,
					createdAt: Date.now(),
				});
			} catch (err) {
				setErrorState(errorMessage(err));
			}
		},
		[
			addMessage,
			clearAbortFallbackTimeout,
			discardPendingStream,
			resetCounters,
			setErrorState,
			startSession,
		],
	);

	const sendPrompt = useCallback(
		async (prompt: string, attachedFiles: File[] = []) => {
			const trimmed = prompt.trim();
			if (!trimmed && attachedFiles.length === 0) return;

			setError(null);
			setIsHydratingSession(false);
			abortedRef.current = false;
			clearAbortFallbackTimeout();
			const pendingSessionStart = sessionStartPromiseRef.current;
			let activeSessionId = sessionId ?? activeSessionIdRef.current;

			const validation = validateConfig(config);
			if (!validation.parsed) {
				setErrorState(validation.error, activeSessionId);
				return;
			}
			const parsed = validation.parsed;
			const hasEarlierPromptSubmission = activePromptSubmissionsRef.current > 0;
			activePromptSubmissionsRef.current += 1;
			let promptSubmissionFinished = false;
			const finishPromptSubmission = () => {
				if (promptSubmissionFinished) return;
				promptSubmissionFinished = true;
				activePromptSubmissionsRef.current = Math.max(
					0,
					activePromptSubmissionsRef.current - 1,
				);
			};
			const precedingPromptDispatch = promptDispatchTailRef.current;
			let resolvePromptDispatch: (() => void) | undefined;
			const ownPromptDispatch = new Promise<void>((resolve) => {
				resolvePromptDispatch = resolve;
			});
			const promptDispatchTail = precedingPromptDispatch.then(
				() => ownPromptDispatch,
			);
			promptDispatchTailRef.current = promptDispatchTail;
			let promptDispatchReleased = false;
			const releasePromptDispatch = () => {
				if (promptDispatchReleased) return;
				promptDispatchReleased = true;
				resolvePromptDispatch?.();
			};
			void promptDispatchTail.then(() => {
				if (promptDispatchTailRef.current === promptDispatchTail) {
					promptDispatchTailRef.current = Promise.resolve();
				}
			});
			const now = Date.now();
			const serializedAttachmentsTask = serializeAttachments(
				attachedFiles,
			).then(
				(attachments) => ({ ok: true as const, attachments }),
				(error: unknown) => ({ ok: false as const, error }),
			);
			const attachedFileCount = attachedFiles.filter(
				(file) => !file.type.startsWith("image/"),
			).length;
			const userLabel =
				attachedFileCount > 0
					? `${trimmed}${trimmed.length > 0 ? "\n\n" : ""}[attached ${attachedFileCount} file${attachedFileCount === 1 ? "" : "s"}]`
					: trimmed;
			const shouldQueue =
				Boolean(activeSessionId) &&
				(hasEarlierPromptSubmission ||
					Boolean(pendingSessionStart) ||
					BUSY_STATUSES.has(status));
			const turnCostTracker: TurnCostTracker | undefined = shouldQueue
				? undefined
				: { streamedCostUsd: 0 };
			const optimisticQueuedPromptId = shouldQueue
				? makeId("queued_prompt")
				: null;
			const optimisticUserMessageId = shouldQueue ? null : makeId("user");
			const plannedSessionId = activeSessionId ?? makeId("session");

			if (optimisticUserMessageId) {
				outstandingOptimisticUserIdsRef.current.add(optimisticUserMessageId);
				addMessage({
					id: optimisticUserMessageId,
					sessionId: plannedSessionId,
					role: "user",
					content: userLabel,
					createdAt: now,
				});
				turnEpochRef.current += 1;
				// Fresh turn: forget any error remembered from a previous turn so
				// a detail-less failure of this turn cannot pick it up.
				delete lastCoreErrorBySessionRef.current[plannedSessionId];
				activeSessionIdRef.current = plannedSessionId;
				activeAssistantMessageIdRef.current = null;
				setActiveAssistantMessageId(null);
				clearLiveToolRefs();
				setStatus("starting");
			} else if (optimisticQueuedPromptId) {
				// Invalidate any in-flight server queue double-check: its snapshot
				// predates this prompt and must not wipe the optimistic queue
				// entry or flip the session to completed.
				turnEpochRef.current += 1;
				setPromptsInQueue((prev) => [
					...prev,
					{
						id: optimisticQueuedPromptId,
						prompt: userLabel,
						steer: false,
					},
				]);
			}

			let sendTask: ReturnType<typeof postSession> | null = null;
			// The turn epoch at send-RPC dispatch time. chat_queued_prompt_start
			// bumps the epoch when the runtime starts consuming a queued prompt,
			// so a mismatch when the send response arrives means the stream has
			// already advanced this turn's lifecycle past the snapshot carried
			// by the response.
			let turnEpochAtDispatch = turnEpochRef.current;
			try {
				if (pendingSessionStart) {
					try {
						activeSessionId = await pendingSessionStart;
					} catch (err) {
						if (optimisticQueuedPromptId) {
							setPromptsInQueue((prev) =>
								prev.filter((item) => item.id !== optimisticQueuedPromptId),
							);
						}
						setErrorState(errorMessage(err), activeSessionId);
						finishPromptSubmission();
						return;
					}
				} else if (
					activeSessionId &&
					hydratedHistorySessionId === activeSessionId
				) {
					const startPromise = startSession(
						{
							...parsed,
							sessionId: activeSessionId,
						},
						{ preserveStatus: true },
					);
					sessionStartPromiseRef.current = startPromise;
					try {
						activeSessionId = await startPromise;
					} catch (err) {
						setErrorState(errorMessage(err), activeSessionId);
						finishPromptSubmission();
						return;
					} finally {
						if (sessionStartPromiseRef.current === startPromise) {
							sessionStartPromiseRef.current = null;
						}
					}
				}

				if (!activeSessionId) {
					const startPromise = startSession(
						{
							...parsed,
							sessionId: plannedSessionId,
						},
						{ preserveStatus: true },
					);
					sessionStartPromiseRef.current = startPromise;
					try {
						activeSessionId = await startPromise;
					} catch (err) {
						if (activeSessionIdRef.current === plannedSessionId) {
							activeSessionIdRef.current = null;
						}
						setErrorState(errorMessage(err));
						finishPromptSubmission();
						return;
					} finally {
						if (sessionStartPromiseRef.current === startPromise) {
							sessionStartPromiseRef.current = null;
						}
					}
				}
				const serializedAttachmentsResult = await serializedAttachmentsTask;
				if (!serializedAttachmentsResult.ok) {
					setErrorState(
						errorMessage(serializedAttachmentsResult.error),
						activeSessionId,
					);
					finishPromptSubmission();
					return;
				}
				const serializedAttachments = serializedAttachmentsResult.attachments;
				const hasAttachments =
					serializedAttachments.userImages.length > 0 ||
					serializedAttachments.userFiles.length > 0;
				if (
					optimisticUserMessageId &&
					serializedAttachments.userImages.length > 0
				) {
					const images = toChatMessageImages(
						serializedAttachments.userImages,
						optimisticUserMessageId,
					);
					if (images.length > 0) {
						setMessages((prev) =>
							updateMessageById(prev, optimisticUserMessageId, (message) => ({
								...message,
								images,
							})),
						);
					}
				}
				if (!shouldQueue) {
					activeSessionIdRef.current = activeSessionId;
					activeTurnCostTrackerRef.current = turnCostTracker ?? null;
					setStatus("starting");
				}
				await precedingPromptDispatch;
				turnEpochAtDispatch = turnEpochRef.current;
				sendTask = postSession({
					action: "send",
					sessionId: activeSessionId,
					prompt: trimmed,
					delivery: shouldQueue ? "queue" : undefined,
					config: parsed,
					attachments: hasAttachments ? serializedAttachments : undefined,
				});
			} finally {
				releasePromptDispatch();
			}
			if (!sendTask) {
				finishPromptSubmission();
				return;
			}
			try {
				const payload = await sendTask;
				if (payload.ok && payload.queued) {
					if (turnEpochRef.current !== turnEpochAtDispatch) {
						// The runtime already started consuming a queued prompt
						// (chat_queued_prompt_start bumped the epoch) while this
						// response was in flight: its queue snapshot predates the
						// dequeue and its "still queued" status is obsolete.
						// Applying them would resurrect a phantom queue entry and
						// could flip a turn that already completed via chat_done
						// back to "running" — wedging the composer forever. The
						// stream (chat_queued_prompt_start/chat_done and
						// prompts_in_queue_state) is authoritative from here on.
						return;
					}
					applyPromptsInQueue(payload.promptsInQueue);
					if (abortedRef.current) {
						turnSettledEpochRef.current = turnEpochRef.current;
						setStatus("cancelled");
						return;
					}
					setStatus("running");
					return;
				}

				const result = payload.result as ChatApiResult | undefined;
				applyPromptsInQueue(payload.promptsInQueue);
				if (abortedRef.current) {
					turnSettledEpochRef.current = turnEpochRef.current;
					setStatus("cancelled");
					return;
				}
				// On a failed run the runtime reports the error string in
				// result.text — it is not assistant content and must not be
				// rendered as an assistant bubble (canonical rehydration would
				// silently wipe it, leaving the user with a blank chat).
				const isErrorResult = result?.finishReason === "error";
				const assistantText = isErrorResult ? "" : (result?.text ?? "").trim();
				const fallbackAssistantTurn = extractAssistantTurnDataFromRpcMessages(
					result?.messages,
				);
				const rawAssistantText = assistantText || fallbackAssistantTurn.text;
				const resolvedAssistantText = rawAssistantText;
				if (resolvedAssistantText) {
					const assistantMessageId =
						activeAssistantMessageIdRef.current ?? makeId("assistant");
					activeAssistantMessageIdRef.current = assistantMessageId;
					setActiveAssistantMessageId(assistantMessageId);
					setMessages((prev) => {
						const updated = updateMessageById(
							prev,
							assistantMessageId,
							(msg) => ({ ...msg, content: resolvedAssistantText }),
						);
						if (updated !== prev) return updated;
						return sliceMessages([
							...prev,
							{
								id: assistantMessageId,
								sessionId: activeSessionId,
								role: "assistant" as const,
								content: resolvedAssistantText,
								reasoning: fallbackAssistantTurn.reasoning || undefined,
								reasoningRedacted:
									fallbackAssistantTurn.reasoningRedacted || undefined,
								createdAt: now + 1,
							},
						]);
					});
				} else if (
					fallbackAssistantTurn.reasoning ||
					fallbackAssistantTurn.reasoningRedacted
				) {
					const assistantMessageId =
						activeAssistantMessageIdRef.current ?? makeId("assistant");
					activeAssistantMessageIdRef.current = assistantMessageId;
					setActiveAssistantMessageId(assistantMessageId);
					setMessages((prev) => {
						const updated = updateMessageById(
							prev,
							assistantMessageId,
							(msg) => ({
								...msg,
								reasoning: fallbackAssistantTurn.reasoning || msg.reasoning,
								reasoningRedacted:
									fallbackAssistantTurn.reasoningRedacted ||
									msg.reasoningRedacted,
							}),
						);
						if (updated !== prev) return updated;
						return sliceMessages([
							...prev,
							{
								id: assistantMessageId,
								sessionId: activeSessionId,
								role: "assistant" as const,
								content: "",
								reasoning: fallbackAssistantTurn.reasoning || undefined,
								reasoningRedacted:
									fallbackAssistantTurn.reasoningRedacted || undefined,
								createdAt: now + 1,
							},
						]);
					});
				}
				const fallbackImages = fallbackAssistantTurn.images.flatMap(
					(candidate) => {
						const image = ChatMessageImageSchema.safeParse({
							id: makeId("generated_image"),
							...candidate,
						});
						return image.success ? [image.data] : [];
					},
				);
				if (fallbackImages.length > 0) {
					const assistantMessageId =
						activeAssistantMessageIdRef.current ?? makeId("assistant");
					activeAssistantMessageIdRef.current = assistantMessageId;
					setActiveAssistantMessageId(assistantMessageId);
					setMessages((prev) => {
						const updated = updateMessageById(
							prev,
							assistantMessageId,
							(message) => {
								const existing = message.images ?? [];
								const additions = fallbackImages.filter(
									(image) =>
										!existing.some(
											(candidate) =>
												candidate.data === image.data &&
												candidate.mediaType === image.mediaType,
										),
								);
								return additions.length > 0
									? { ...message, images: [...existing, ...additions] }
									: message;
							},
						);
						if (updated !== prev) return updated;
						return sliceMessages([
							...prev,
							{
								id: assistantMessageId,
								sessionId: activeSessionId,
								role: "assistant" as const,
								content: resolvedAssistantText,
								images: fallbackImages,
								reasoning: fallbackAssistantTurn.reasoning || undefined,
								reasoningRedacted:
									fallbackAssistantTurn.reasoningRedacted || undefined,
								createdAt: now + 1,
							},
						]);
					});
				}
				const fallbackMedia = fallbackAssistantTurn.media;
				if (fallbackMedia.length > 0) {
					setMessages((prev) => {
						const knownIds = new Set(
							prev.flatMap((message) =>
								(message.media ?? []).map((media) => media.id),
							),
						);
						const additions = fallbackMedia.filter(
							(media) => !knownIds.has(media.id),
						);
						return additions.length === 0
							? prev
							: sliceMessages([
									...prev,
									...additions.map((media, index) => ({
										id: `media_${media.id}`,
										sessionId: activeSessionId,
										role: "assistant" as const,
										content: "",
										media: [media],
										createdAt: now + 2 + index,
									})),
								]);
					});
				}
				const hasFallbackAssistantTurn =
					Boolean(resolvedAssistantText) ||
					Boolean(fallbackAssistantTurn.reasoning) ||
					fallbackAssistantTurn.reasoningRedacted ||
					fallbackImages.length > 0 ||
					fallbackMedia.length > 0;
				if (!hasFallbackAssistantTurn) {
					// Recovery: load canonical messages if transport missed result text.
					try {
						const historyMessages = await desktopClient.invoke<ChatMessage[]>(
							"read_session_messages",
							{ sessionId: activeSessionId, maxMessages: MAX_MESSAGES },
						);
						if (historyMessages.length > 0) {
							applyCanonicalHistory(activeSessionId, historyMessages);
						}
					} catch {
						// Keep optimistic state if hydration read fails.
					}
				}
				if (Array.isArray(result?.toolCalls) && result.toolCalls.length > 0) {
					materializeToolMessagesFromResult({
						sessionId: activeSessionId,
						turnStartedAt: now,
						toolCalls: result.toolCalls,
					});
				}

				try {
					const historyMessages = await desktopClient.invoke<ChatMessage[]>(
						"read_session_messages",
						{ sessionId: activeSessionId, maxMessages: MAX_MESSAGES },
					);
					const hasCanonicalAssistantTurn = historyMessages.some(
						(message) => message.role === "assistant",
					);
					if (
						historyMessages.length > 0 &&
						(!hasFallbackAssistantTurn || hasCanonicalAssistantTurn)
					) {
						const assistantIndex = historyMessages.findLastIndex(
							(message) => message.role === "assistant",
						);
						const canonicalMessages =
							assistantIndex >= 0 && hasFallbackAssistantTurn
								? historyMessages.map((message, index) => {
										if (index !== assistantIndex) return message;
										const existingImages = message.images ?? [];
										const missingImages = fallbackImages.filter(
											(image) =>
												!existingImages.some(
													(candidate) =>
														candidate.data === image.data &&
														candidate.mediaType === image.mediaType,
												),
										);
										return {
											...message,
											content: message.content || resolvedAssistantText,
											reasoning:
												message.reasoning ||
												fallbackAssistantTurn.reasoning ||
												undefined,
											reasoningRedacted:
												message.reasoningRedacted ||
												fallbackAssistantTurn.reasoningRedacted ||
												undefined,
											images:
												missingImages.length > 0
													? [...existingImages, ...missingImages]
													: message.images,
										};
									})
								: historyMessages;
						applyCanonicalHistory(activeSessionId, canonicalMessages);
					}
				} catch {
					// Keep optimistic state if canonical hydration fails.
				}

				// Token / cost bookkeeping
				const inputTokens = result?.usage?.inputTokens ?? result?.inputTokens;
				if (typeof inputTokens === "number") {
					setTokensIn(inputTokens);
				}
				const outputTokens =
					result?.usage?.outputTokens ?? result?.outputTokens;
				if (typeof outputTokens === "number") {
					setTokensOut(outputTokens);
				}
				const resultCacheReadTokens =
					result?.usage?.cacheReadTokens ?? result?.cacheReadTokens;
				if (typeof resultCacheReadTokens === "number") {
					setCacheReadTokens(resultCacheReadTokens);
				}
				const totalCost =
					typeof result?.usage?.totalCost === "number"
						? result.usage.totalCost
						: undefined;
				const streamedTurnCostUsd = turnCostTracker?.streamedCostUsd ?? 0;
				if (activeTurnCostTrackerRef.current === turnCostTracker) {
					activeTurnCostTrackerRef.current = null;
				}
				if (typeof totalCost === "number") {
					const unstreamedCostUsd = totalCost - streamedTurnCostUsd;
					unpersistedCostUsdRef.current += unstreamedCostUsd;
					setTotalCostUsd((previous) => previous + unstreamedCostUsd);
				}
				const assistantMessageId = activeAssistantMessageIdRef.current;
				if (
					assistantMessageId &&
					(typeof inputTokens === "number" ||
						typeof outputTokens === "number" ||
						typeof resultCacheReadTokens === "number" ||
						typeof totalCost === "number")
				) {
					setMessages((prev) =>
						updateMessageById(prev, assistantMessageId, (msg) => ({
							...msg,
							meta: {
								...(msg.meta ?? {}),
								inputTokens:
									typeof inputTokens === "number"
										? inputTokens
										: msg.meta?.inputTokens,
								outputTokens:
									typeof outputTokens === "number"
										? outputTokens
										: msg.meta?.outputTokens,
								cacheReadTokens:
									typeof resultCacheReadTokens === "number"
										? resultCacheReadTokens
										: msg.meta?.cacheReadTokens,
								totalCost:
									typeof totalCost === "number"
										? totalCost
										: msg.meta?.totalCost,
								providerId: config.provider,
								modelId: config.model,
							},
						})),
					);
				}

				const hasQueuedFollowUps =
					Array.isArray(payload.promptsInQueue) &&
					payload.promptsInQueue.length > 0;
				if (abortedRef.current) {
					turnSettledEpochRef.current = turnEpochRef.current;
					setStatus("cancelled");
				} else if (result?.finishReason === "error") {
					// On a failed run result.text is the runtime's error string
					// (never assistant content — see isErrorResult above), so it
					// is the best failure detail available. The reporter dedupes
					// against the chat_done stream path.
					const runError = (result?.text ?? "").trim();
					const toolError = Array.isArray(result?.toolCalls)
						? result.toolCalls.find((c) => c.error)?.error
						: undefined;
					appendTurnFailureMessage(
						activeSessionId,
						runError || toolError?.trim() || "",
					);
					turnSettledEpochRef.current = turnEpochRef.current;
					setStatus("failed");
				} else if (result?.finishReason === "aborted") {
					turnSettledEpochRef.current = turnEpochRef.current;
					setStatus("cancelled");
				} else if (hasQueuedFollowUps) {
					setStatus("running");
				} else {
					turnSettledEpochRef.current = turnEpochRef.current;
					setStatus("completed");
				}
				void refreshSessionDiffSummary(activeSessionId);
			} catch (err) {
				if (abortedRef.current) {
					setStatus("cancelled");
					return;
				}
				if (optimisticQueuedPromptId) {
					setPromptsInQueue((prev) =>
						prev.filter((item) => item.id !== optimisticQueuedPromptId),
					);
				}
				setErrorState(errorMessage(err), activeSessionId);
			} finally {
				clearAbortFallbackTimeout();
				if (!shouldQueue) {
					activeAssistantMessageIdRef.current = null;
					setActiveAssistantMessageId(null);
					clearLiveToolRefs();
				}
				finishPromptSubmission();
			}
		},
		[
			addMessage,
			appendTurnFailureMessage,
			applyCanonicalHistory,
			applyPromptsInQueue,
			clearAbortFallbackTimeout,
			clearLiveToolRefs,
			config,
			hydratedHistorySessionId,
			materializeToolMessagesFromResult,
			refreshSessionDiffSummary,
			sessionId,
			setErrorState,
			startSession,
			status,
			postSession,
		],
	);

	const respondToolApproval = useCallback(
		async (requestId: string, approved: boolean) => {
			const activeSessionId = activeSessionIdRef.current;
			if (!activeSessionId) return;
			await desktopClient.invoke("respond_tool_approval", {
				sessionId: activeSessionId,
				requestId,
				approved,
				reason: approved
					? undefined
					: "Tool call rejected from desktop approval prompt",
			});
			setPendingToolApprovals((prev) =>
				prev.filter((item) => item.requestId !== requestId),
			);
		},
		[],
	);

	const approveToolApproval = useCallback(
		(requestId: string) => respondToolApproval(requestId, true),
		[respondToolApproval],
	);

	const rejectToolApproval = useCallback(
		(requestId: string) => respondToolApproval(requestId, false),
		[respondToolApproval],
	);

	const answerAskQuestion = useCallback(
		async (requestId: string, answer: string) => {
			await desktopClient.invoke("respond_ask_question", {
				requestId,
				answer,
			});
			setPendingAskQuestions((prev) =>
				prev.filter((item) => item.requestId !== requestId),
			);
		},
		[],
	);

	const restoreCheckpoint = useCallback(
		async (checkpointRunCount: number) => {
			const activeSessionId = activeSessionIdRef.current;
			if (!activeSessionId) {
				throw new Error("No active session to restore");
			}
			if (BUSY_STATUSES.has(status)) {
				throw new Error("Wait for the current turn to finish before undoing");
			}

			clearAbortFallbackTimeout();
			setError(null);
			setIsHydratingSession(false);
			activeAssistantMessageIdRef.current = null;
			setActiveAssistantMessageId(null);
			setPendingToolApprovals([]);
			setPendingAskQuestions([]);
			setPromptsInQueue([]);
			clearLiveToolRefs();

			const payload = (await postSession({
				action: "restore_checkpoint",
				sessionId: activeSessionId,
				checkpointRunCount,
				config,
			})) as {
				sessionId?: string;
			};
			const nextSessionId =
				typeof payload.sessionId === "string" ? payload.sessionId.trim() : "";
			if (!nextSessionId) {
				throw new Error("Checkpoint restore did not return a new session id");
			}

			const nextMessages = await desktopClient.invoke<ChatMessage[]>(
				"read_session_messages",
				{
					sessionId: nextSessionId,
					maxMessages: MAX_MESSAGES,
				},
			);

			setSessionId(nextSessionId);
			activeSessionIdRef.current = nextSessionId;
			setMessages(nextMessages);
			setRawTranscript("");
			setStatus(nextMessages.length > 0 ? "completed" : "idle");
			resetCounters();
			void refreshSessionDiffSummary(nextSessionId);
			void refreshPromptsInQueue(nextSessionId);
		},
		[
			clearAbortFallbackTimeout,
			clearLiveToolRefs,
			config,
			postSession,
			refreshPromptsInQueue,
			refreshSessionDiffSummary,
			resetCounters,
			status,
		],
	);

	const abort = useCallback(async () => {
		if (!sessionId) return;
		abortedRef.current = true;
		setStatus("stopping");
		clearAbortFallbackTimeout();
		abortFallbackTimeoutRef.current = setTimeout(() => {
			if (abortedRef.current) {
				setStatus("cancelled");
			}
			abortFallbackTimeoutRef.current = null;
		}, 2000);
		try {
			const response = await postSession({ action: "abort", sessionId });
			if (!response.ok) {
				abortedRef.current = false;
				clearAbortFallbackTimeout();
				setStatus("running");
			}
		} catch {
			abortedRef.current = false;
			clearAbortFallbackTimeout();
			setStatus("running");
		}
	}, [clearAbortFallbackTimeout, postSession, sessionId]);

	const proceedWhileRunning = useCallback(
		async (targetSessionId: string, toolCallId?: string) => {
			const normalizedSessionId = targetSessionId.trim();
			if (!normalizedSessionId) {
				throw new Error("No active session.");
			}
			const response = await desktopClient.invoke<{ detachedCount?: number }>(
				"proceed_while_running",
				{
					sessionId: normalizedSessionId,
					...(toolCallId ? { toolCallId } : {}),
				},
			);
			if ((response.detachedCount ?? 0) < 1) {
				throw new Error("The command finished before it could be detached.");
			}
		},
		[],
	);

	const reset = useCallback(async () => {
		const activeSessionId = sessionId;
		setSessionId(null);
		setStatus("idle");
		setIsHydratingSession(false);
		abortedRef.current = false;
		clearAbortFallbackTimeout();
		discardPendingStream();
		setMessages([]);
		setRawTranscript("");
		setError(null);
		resetCounters();
		setConfig((prev) => {
			// Re-seed the composer from the remembered defaults (the same
			// source a freshly mounted thread uses) so a reset after viewing
			// a historical session does not retain that session's
			// provider/model for the next chat.
			const initial = getInitialChatConfig();
			return {
				...prev,
				sessionId: undefined,
				provider: initial.provider,
				model: initial.model,
				apiKey:
					prev.provider === initial.provider ? prev.apiKey : initial.apiKey,
			};
		});
		activeSessionIdRef.current = null;
		sessionStartPromiseRef.current = null;
		outstandingOptimisticUserIdsRef.current.clear();
		rekeyedOptimisticIdByMessageIdRef.current = {};
		lastCoreErrorBySessionRef.current = {};
		activeAssistantMessageIdRef.current = null;
		setActiveAssistantMessageId(null);
		setHydratedHistorySessionId(null);
		setPendingToolApprovals([]);
		setPendingAskQuestions([]);
		setPromptsInQueue([]);
		clearLiveToolRefs();
		if (activeSessionId) {
			try {
				await postSession({ action: "reset", sessionId: activeSessionId });
			} catch {
				// Best-effort reset path.
			}
		}
	}, [
		sessionId,
		clearAbortFallbackTimeout,
		discardPendingStream,
		postSession,
		resetCounters,
		clearLiveToolRefs,
	]);

	const hydrateSession = useCallback(
		async (session: SessionHistoryItem) => {
			const requestId = hydrationRequestIdRef.current + 1;
			const hydrationStartedAt = Date.now();
			hydrationRequestIdRef.current = requestId;
			setError(null);
			setStatus("starting");
			setIsHydratingSession(true);
			resetStreamDedupe(session.sessionId);
			abortedRef.current = false;
			clearAbortFallbackTimeout();
			setSessionId(session.sessionId);
			setConfig((prev) => ({
				...prev,
				sessionId: session.sessionId,
				provider: session.provider || prev.provider,
				model: session.model || prev.model,
				workspaceRoot: session.workspaceRoot || prev.workspaceRoot,
				cwd: session.workspaceRoot || session.cwd || prev.cwd,
			}));
			activeSessionIdRef.current = session.sessionId;
			activeAssistantMessageIdRef.current = null;
			setActiveAssistantMessageId(null);
			setHydratedHistorySessionId(session.sessionId);
			setPendingToolApprovals([]);
			setPendingAskQuestions([]);
			setPromptsInQueue([]);
			clearLiveToolRefs();
			discardPendingStream();

			const applyHydratedMessages = (
				msgs: ChatMessage[],
				sessionStatus: typeof session.status,
			) => {
				outstandingOptimisticUserIdsRef.current.clear();
				rekeyedOptimisticIdByMessageIdRef.current = {};
				lastCoreErrorBySessionRef.current = {};
				const mergedMessages = mergeHydratedMessagesWithLive({
					hydrated: msgs,
					current: messagesRef.current,
					sessionId: session.sessionId,
					hydrationStartedAt,
				});
				// Hub attachment starts forwarding future events but does not replay the
				// tool.started event for a command already in flight. Rebuild its routing
				// key from canonical history before those future updates can arrive.
				const liveToolState = deriveLiveToolState(mergedMessages);
				liveToolMessageIdsRef.current = liveToolState.messageIds;
				liveToolInputsRef.current = liveToolState.inputs;
				setMessages(mergedMessages);
				setRawTranscript("");
				resetCounters();
				setStatus(inferHydratedChatStatus(sessionStatus, msgs));
				void refreshSessionDiffSummary(session.sessionId);
			};

			try {
				const historyMessages = await desktopClient.invoke<ChatMessage[]>(
					"read_session_messages",
					{ sessionId: session.sessionId, maxMessages: MAX_MESSAGES },
				);
				if (hydrationRequestIdRef.current !== requestId) return;
				if (historyMessages.length > 0) {
					void refreshPromptsInQueue(session.sessionId);
					applyHydratedMessages(historyMessages, session.status);
					setIsHydratingSession(false);
				}

				const attached = await desktopClient
					.invoke<{
						sessionId?: string;
						status?: string;
						provider?: string;
						model?: string;
						cwd?: string;
						workspaceRoot?: string;
						prompt?: string;
					}>("chat_session_command", {
						request: {
							action: "attach",
							sessionId: session.sessionId,
							config: {
								provider: session.provider,
								model: session.model,
								cwd: session.cwd,
								workspaceRoot: session.workspaceRoot,
							},
						},
					})
					.catch((err) => {
						if (historyMessages.length === 0) {
							throw err;
						}
						setError(errorMessage(err));
						return undefined;
					});
				if (hydrationRequestIdRef.current !== requestId) return;
				setConfig((prev) => ({
					...prev,
					sessionId: session.sessionId,
					provider: attached?.provider || session.provider || prev.provider,
					model: attached?.model || session.model || prev.model,
					workspaceRoot:
						attached?.workspaceRoot ||
						session.workspaceRoot ||
						prev.workspaceRoot,
					cwd:
						attached?.cwd ||
						attached?.workspaceRoot ||
						session.workspaceRoot ||
						session.cwd ||
						prev.cwd,
				}));

				if (historyMessages.length > 0) {
					setStatus(
						inferHydratedChatStatus(
							(attached?.status || session.status) as SessionHistoryStatus,
							historyMessages,
						),
					);
					return;
				}

				const synthesized: ChatMessage[] = [];
				if (session.prompt?.trim()) {
					synthesized.push({
						id: makeId("history_user"),
						sessionId: session.sessionId,
						role: "user",
						content: session.prompt.trim(),
						createdAt: Date.now(),
					});
				}
				void refreshPromptsInQueue(session.sessionId);
				applyHydratedMessages(
					synthesized,
					(attached?.status || session.status) as SessionHistoryStatus,
				);
			} catch (err) {
				if (hydrationRequestIdRef.current !== requestId) return;
				const msg = errorMessage(err);
				setError(msg);
				setStatus("error");
				setMessages([makeErrorChatMessage(session.sessionId, msg)]);
			} finally {
				if (hydrationRequestIdRef.current === requestId) {
					setIsHydratingSession(false);
				}
			}
		},
		[
			clearAbortFallbackTimeout,
			clearLiveToolRefs,
			discardPendingStream,
			refreshPromptsInQueue,
			refreshSessionDiffSummary,
			resetStreamDedupe,
			resetCounters,
		],
	);

	const forkSession = useCallback(
		async (options?: {
			beforeRunCount?: number;
		}): Promise<{
			newSessionId: string;
			forkedFromSessionId: string;
			messages: ChatMessage[];
		}> => {
			const activeSessionId = activeSessionIdRef.current;
			if (!activeSessionId) {
				throw new Error("No active session to fork.");
			}
			if (BUSY_STATUSES.has(status)) {
				throw new Error("Wait for the current turn to finish before forking.");
			}
			const payload = (await postSession({
				action: "fork",
				sessionId: activeSessionId,
				config,
				forkBeforeRunCount: options?.beforeRunCount,
			})) as {
				sessionId?: string;
				forkedFromSessionId?: string;
			};
			const newSessionId =
				typeof payload.sessionId === "string" ? payload.sessionId.trim() : "";
			if (!newSessionId) {
				throw new Error("Fork did not return a new session id.");
			}
			const forkedFromSessionId =
				typeof payload.forkedFromSessionId === "string"
					? payload.forkedFromSessionId
					: activeSessionId;
			const nextMessages = await desktopClient.invoke<ChatMessage[]>(
				"read_session_messages",
				{
					sessionId: newSessionId,
					maxMessages: MAX_MESSAGES,
				},
			);
			return { newSessionId, forkedFromSessionId, messages: nextMessages };
		},
		[config, postSession, status],
	);

	const steerPromptInQueue = useCallback(
		async (promptId: string) => {
			const activeSessionId = activeSessionIdRef.current;
			if (!activeSessionId || !promptId.trim()) {
				return;
			}
			const payload = await postSession({
				action: "steer_prompt",
				sessionId: activeSessionId,
				promptId,
			});
			setPromptsInQueue(
				Array.isArray(payload.promptsInQueue) ? payload.promptsInQueue : [],
			);
		},
		[postSession],
	);

	const updatePromptInQueue = useCallback(
		async (promptId: string, prompt: string) => {
			const activeSessionId = activeSessionIdRef.current;
			if (!activeSessionId || !promptId.trim()) {
				return;
			}
			const payload = await postSession({
				action: "update_pending_prompt",
				sessionId: activeSessionId,
				promptId,
				prompt,
			});
			setPromptsInQueue(
				Array.isArray(payload.promptsInQueue) ? payload.promptsInQueue : [],
			);
		},
		[postSession],
	);

	const removePromptInQueue = useCallback(
		async (promptId: string): Promise<PromptInQueue | undefined> => {
			const activeSessionId = activeSessionIdRef.current;
			if (!activeSessionId || !promptId.trim()) {
				return undefined;
			}
			const payload = await postSession({
				action: "remove_pending_prompt",
				sessionId: activeSessionId,
				promptId,
			});
			setPromptsInQueue(
				Array.isArray(payload.promptsInQueue) ? payload.promptsInQueue : [],
			);
			return payload.prompt;
		},
		[postSession],
	);

	const summary = useMemo(
		() => ({
			toolCalls,
			tokensIn,
			tokensOut,
			cacheReadTokens,
			totalCostUsd,
			additions: diffSummary.additions,
			deletions: diffSummary.deletions,
		}),
		[
			diffSummary.additions,
			diffSummary.deletions,
			tokensIn,
			tokensOut,
			cacheReadTokens,
			totalCostUsd,
			toolCalls,
		],
	);

	return {
		sessionId,
		status,
		chatTransportState,
		chatTransportError,
		isHydratingSession,
		activeAssistantMessageId,
		config,
		messages,
		rawTranscript,
		error,
		summary,
		fileDiffs,
		promptsInQueue,
		pendingToolApprovals,
		pendingAskQuestions,
		setConfig,
		setWorkspacePath,
		start,
		hydrateSession,
		sendPrompt,
		steerPromptInQueue,
		updatePromptInQueue,
		removePromptInQueue,
		approveToolApproval,
		rejectToolApproval,
		answerAskQuestion,
		restoreCheckpoint,
		forkSession,
		proceedWhileRunning,
		abort,
		stop: abort,
		reset,
	};
}
