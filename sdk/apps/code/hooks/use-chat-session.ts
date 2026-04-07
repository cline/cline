"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { serializeAttachments } from "@/hooks/chat-session/attachments";
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
	ChatApiResult,
	ChatSessionHookEvent,
	ChatTransportState,
	CoreLogChunk,
	ProcessContext,
	PromptInQueue,
	ReasoningDeltaEvent,
	ToolApprovalRequestItem,
	ToolCallEndEvent,
	ToolCallStartEvent,
} from "@/hooks/chat-session/types";
import {
	type ChatMessage,
	type ChatSessionConfig,
	ChatSessionConfigSchema,
	type ChatSessionStatus,
} from "@/lib/chat-schema";
import { desktopClient } from "@/lib/desktop-client";
import {
	buildSessionDiffState,
	EMPTY_DIFF_SUMMARY,
	type SessionDiffSummary,
	type SessionFileDiff,
} from "@/lib/session-diff";
import type { SessionHistoryItem } from "@/lib/session-history";

export { DEFAULT_CHAT_CONFIG } from "@/hooks/chat-session/constants";

const MAX_MESSAGES = 800;

const RELEVANT_STREAMS = new Set([
	"chat_text",
	"chat_reasoning",
	"chat_queued_prompt_start",
	"chat_tool_call_start",
	"chat_tool_call_end",
	"chat_core_log",
]);

const BUSY_STATUSES = new Set<ChatSessionStatus>([
	"starting",
	"running",
	"stopping",
]);

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

// ---------------------------------------------------------------------------
// Core log dispatcher — avoids repeated if/else chains
// ---------------------------------------------------------------------------

const LOG_DISPATCH: Record<string, typeof console.info> = {
	error: console.error,
	warn: console.warn,
	debug: console.debug,
};

function dispatchCoreLog(chunk: string): void {
	let parsed: CoreLogChunk | undefined;
	try {
		parsed = JSON.parse(chunk) as CoreLogChunk;
	} catch {
		console.info("[core]", chunk);
		return;
	}
	const level = parsed.level?.trim().toLowerCase() || "info";
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
	const [fileDiffs, setFileDiffs] = useState<SessionFileDiff[]>([]);
	const [diffSummary, setDiffSummary] =
		useState<SessionDiffSummary>(EMPTY_DIFF_SUMMARY);
	const [activeAssistantMessageId, setActiveAssistantMessageId] = useState<
		string | null
	>(null);
	const [_hydratedHistorySessionId, setHydratedHistorySessionId] = useState<
		string | null
	>(null);
	const [pendingToolApprovals, setPendingToolApprovals] = useState<
		ToolApprovalRequestItem[]
	>([]);
	const [promptsInQueue, setPromptsInQueue] = useState<PromptInQueue[]>([]);
	const liveToolMessageIdsRef = useRef<Record<string, string>>({});
	const liveToolInputsRef = useRef<Record<string, unknown>>({});
	const activeSessionIdRef = useRef<string | null>(null);
	const activeAssistantMessageIdRef = useRef<string | null>(null);
	const abortedRef = useRef(false);
	const abortFallbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const hydrationRequestIdRef = useRef(0);
	const [chatTransportState, setChatTransportState] =
		useState<ChatTransportState>(desktopClient.getTransportState());
	// ---- Ref syncs ----

	useEffect(() => {
		activeSessionIdRef.current = sessionId;
	}, [sessionId]);
	useEffect(() => {
		activeAssistantMessageIdRef.current = activeAssistantMessageId;
	}, [activeAssistantMessageId]);

	// ---- Shared state reset helpers ----

	const clearLiveToolRefs = useCallback(() => {
		liveToolMessageIdsRef.current = {};
		liveToolInputsRef.current = {};
	}, []);

	const clearAbortFallbackTimeout = useCallback(() => {
		if (abortFallbackTimeoutRef.current) {
			clearTimeout(abortFallbackTimeoutRef.current);
			abortFallbackTimeoutRef.current = null;
		}
	}, []);

	const resetCounters = useCallback(() => {
		setToolCalls(0);
		setTokensIn(0);
		setTokensOut(0);
		setFileDiffs([]);
		setDiffSummary(EMPTY_DIFF_SUMMARY);
	}, []);

	const setErrorState = useCallback(
		(msg: string, sid: string | null = null) => {
			setError(msg);
			setStatus("error");
			setMessages((prev) =>
				sliceMessages([...prev, makeErrorChatMessage(sid, msg)]),
			);
		},
		[],
	);

	// ---- Data fetching ----

	const postSession = useCallback(async (body: Record<string, unknown>) => {
		return await desktopClient.invoke<{
			sessionId?: string;
			result?: ChatApiResult;
			ok?: boolean;
			queued?: boolean;
			promptsInQueue?: PromptInQueue[];
		}>("chat_session_command", { request: body });
	}, []);

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

	const refreshSessionDiffSummary = useCallback(
		async (targetSessionId: string) => {
			try {
				const events = await desktopClient.invoke<ChatSessionHookEvent[]>(
					"read_session_hooks",
					{ sessionId: targetSessionId, limit: MAX_MESSAGES },
				);
				const diffState = buildSessionDiffState(events);
				setFileDiffs(diffState.fileDiffs);
				setDiffSummary(diffState.summary);
				setToolCalls(
					events.filter(
						(e) =>
							e.hookEventName === "tool_call" || e.hookName === "tool_call",
					).length,
				);
				setTokensIn(events.reduce((sum, e) => sum + (e.inputTokens ?? 0), 0));
				setTokensOut(events.reduce((sum, e) => sum + (e.outputTokens ?? 0), 0));
			} catch {
				// Ignore in non-Tauri mode.
			}
		},
		[],
	);

	// ---- Message helpers ----

	const addMessage = useCallback((message: ChatMessage) => {
		setMessages((prev) => sliceMessages([...prev, message]));
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

	// ---- Process context ----

	const applyProcessContext = useCallback(async () => {
		try {
			const ctx = await desktopClient.invoke<ProcessContext>(
				"get_process_context",
			);
			setConfig((prev) => ({
				...prev,
				workspaceRoot: ctx.workspaceRoot || ctx.cwd,
				cwd: ctx.workspaceRoot || ctx.cwd,
			}));
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
			setPromptsInQueue([]);
			return;
		}
		void refreshSessionDiffSummary(sessionId);
		void refreshPromptsInQueue(sessionId);
	}, [refreshPromptsInQueue, refreshSessionDiffSummary, sessionId]);

	useEffect(() => {
		const activeSessionId = sessionId;
		if (!activeSessionId) {
			setPendingToolApprovals([]);
			return;
		}

		void desktopClient
			.invoke<ToolApprovalRequestItem[]>("poll_tool_approvals", {
				sessionId: activeSessionId,
				limit: 20,
			})
			.then((pending) => setPendingToolApprovals(pending))
			.catch(() => {});

		return desktopClient.subscribe("tool_approval_state", (payload) => {
			if (!payload || typeof payload !== "object") return;
			const record = payload as {
				sessionId?: string;
				items?: ToolApprovalRequestItem[];
			};
			if (record.sessionId !== activeSessionId) return;
			setPendingToolApprovals(Array.isArray(record.items) ? record.items : []);
		});
	}, [sessionId]);

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

			const listeningSessionId = activeSessionIdRef.current;
			if (!listeningSessionId || payload.sessionId !== listeningSessionId) {
				return;
			}
			if (abortedRef.current) {
				return;
			}

			if (payload.stream === "chat_queued_prompt_start") {
				let parsed: { prompt?: string; attachmentCount?: number } = {};
				try {
					parsed = JSON.parse(payload.chunk) as {
						prompt?: string;
						attachmentCount?: number;
					};
				} catch {
					parsed = { prompt: payload.chunk };
				}
				const prompt = parsed.prompt?.trim() ?? "";
				const attachmentCount =
					typeof parsed.attachmentCount === "number"
						? parsed.attachmentCount
						: 0;
				const userLabel =
					attachmentCount > 0
						? `${prompt}${prompt.length > 0 ? "\n\n" : ""}[attached ${attachmentCount} file${attachmentCount === 1 ? "" : "s"}]`
						: prompt;
				activeAssistantMessageIdRef.current = null;
				setActiveAssistantMessageId(null);
				clearLiveToolRefs();
				setStatus("running");
				if (userLabel) {
					addMessage({
						id: makeId("user"),
						sessionId: listeningSessionId,
						role: "user",
						content: userLabel,
						createdAt: payload.ts || Date.now(),
					});
				}
				return;
			}

			// --- Text stream ---
			if (payload.stream === "chat_text") {
				let assistantId = activeAssistantMessageIdRef.current;
				if (!assistantId) {
					assistantId = makeId("assistant");
					addMessage({
						id: assistantId,
						sessionId: listeningSessionId,
						role: "assistant",
						content: "",
						createdAt: payload.ts || Date.now(),
					});
					activeAssistantMessageIdRef.current = assistantId;
					setActiveAssistantMessageId(assistantId);
				}
				appendMessageContent(assistantId, payload.chunk);
				setRawTranscript((prev) => `${prev}${payload.chunk}`);
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
						createdAt: payload.ts || Date.now(),
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
				appendMessageReasoning(
					assistantId,
					parsed.text ?? "",
					parsed.redacted === true,
				);
				return;
			}

			// --- Core log ---
			if (payload.stream === "chat_core_log") {
				dispatchCoreLog(payload.chunk);
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
					createdAt: Date.now(),
					meta: { toolName, hookEventName: "tool_call_start" },
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
						meta: { ...msg.meta, toolName, hookEventName: "tool_call_end" },
					})),
				);
				return;
			}
			// Ignore unmatched tool end events so stale completions from the
			// previous turn do not get rendered under a newer streaming turn.
		},
		[
			addMessage,
			appendMessageContent,
			appendMessageReasoning,
			clearLiveToolRefs,
		],
	);

	// ---- Transport / event subscriptions ----

	useEffect(() => {
		const unsubscribeTransport = desktopClient.subscribeTransportState(
			setChatTransportState,
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

	// ---- Shared: start a new session via RPC ----

	const startSession = useCallback(
		async (validatedConfig: ChatSessionConfig): Promise<string> => {
			const payload = await postSession({
				action: "start",
				config: validatedConfig,
			});
			const id = payload.sessionId;
			if (!id) throw new Error("Missing session id from server");
			setSessionId(id);
			setStatus("running");
			setConfig(validatedConfig);
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
		[addMessage, resetCounters, setErrorState, startSession],
	);

	const sendPrompt = useCallback(
		async (prompt: string, attachedFiles: File[] = []) => {
			const trimmed = prompt.trim();
			if (!trimmed && attachedFiles.length === 0) return;

			setError(null);
			setIsHydratingSession(false);
			abortedRef.current = false;
			clearAbortFallbackTimeout();
			let activeSessionId = sessionId;

			const validation = validateConfig(config);
			if (!validation.parsed) {
				setErrorState(validation.error, activeSessionId);
				return;
			}
			const parsed = validation.parsed;

			if (!activeSessionId) {
				try {
					activeSessionId = await startSession(parsed);
				} catch (err) {
					setErrorState(errorMessage(err));
					return;
				}
			}

			const now = Date.now();
			const shouldQueue = Boolean(activeSessionId) && BUSY_STATUSES.has(status);
			const serializedAttachments = await serializeAttachments(attachedFiles);
			const hasAttachments =
				serializedAttachments.userImages.length > 0 ||
				serializedAttachments.userFiles.length > 0;

			const userLabel = hasAttachments
				? `${trimmed}${trimmed.length > 0 ? "\n\n" : ""}[attached ${attachedFiles.length} file${attachedFiles.length === 1 ? "" : "s"}]`
				: trimmed;
			const optimisticQueuedPromptId = shouldQueue
				? makeId("queued_prompt")
				: null;

			if (!shouldQueue) {
				addMessage({
					id: makeId("user"),
					sessionId: activeSessionId,
					role: "user",
					content: userLabel,
					createdAt: now,
				});
				activeSessionIdRef.current = activeSessionId;
				activeAssistantMessageIdRef.current = null;
				setActiveAssistantMessageId(null);
				clearLiveToolRefs();
				setStatus("starting");
			} else if (optimisticQueuedPromptId) {
				setPromptsInQueue((prev) => [
					...prev,
					{
						id: optimisticQueuedPromptId,
						prompt: userLabel,
						steer: false,
					},
				]);
			}
			try {
				const payload = await postSession({
					action: "send",
					sessionId: activeSessionId,
					prompt: trimmed,
					delivery: shouldQueue ? "queue" : undefined,
					config: parsed,
					attachments: hasAttachments ? serializedAttachments : undefined,
				});
				if (payload.ok && payload.queued) {
					applyPromptsInQueue(payload.promptsInQueue);
					setStatus("running");
					return;
				}

				const result = payload.result as ChatApiResult | undefined;
				applyPromptsInQueue(payload.promptsInQueue);
				if (abortedRef.current) {
					setStatus("cancelled");
					return;
				}
				const assistantText = (result?.text ?? "").trim();
				const fallbackAssistantTurn = extractAssistantTurnDataFromRpcMessages(
					result?.messages,
				);
				const resolvedAssistantText =
					assistantText || fallbackAssistantTurn.text;
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
				} else {
					// Recovery: load canonical messages if transport missed result text.
					try {
						const historyMessages = await desktopClient.invoke<ChatMessage[]>(
							"read_session_messages",
							{ sessionId: activeSessionId, maxMessages: MAX_MESSAGES },
						);
						if (historyMessages.length > 0) {
							setMessages(historyMessages);
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

				// Token / cost bookkeeping
				const inputTokens = result?.usage?.inputTokens ?? result?.inputTokens;
				if (typeof inputTokens === "number") {
					setTokensIn((prev) => prev + inputTokens);
				}
				const outputTokens =
					result?.usage?.outputTokens ?? result?.outputTokens;
				if (typeof outputTokens === "number") {
					setTokensOut((prev) => prev + outputTokens);
				}
				const totalCost =
					typeof result?.usage?.totalCost === "number"
						? result.usage.totalCost
						: undefined;
				const assistantMessageId = activeAssistantMessageIdRef.current;
				if (
					assistantMessageId &&
					(typeof inputTokens === "number" ||
						typeof outputTokens === "number" ||
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
					setStatus("cancelled");
				} else if (result?.finishReason === "error") {
					if (!resolvedAssistantText) {
						const toolError = Array.isArray(result?.toolCalls)
							? result.toolCalls.find((c) => c.error)?.error
							: undefined;
						addMessage(
							makeErrorChatMessage(
								activeSessionId,
								toolError?.trim() ||
									"Runtime turn failed before an assistant response was produced.",
							),
						);
					}
					setStatus("failed");
				} else if (result?.finishReason === "aborted") {
					setStatus("cancelled");
				} else if (hasQueuedFollowUps) {
					setStatus("running");
				} else {
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
			}
		},
		[
			addMessage,
			applyPromptsInQueue,
			clearAbortFallbackTimeout,
			clearLiveToolRefs,
			config,
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
			setPromptsInQueue([]);
			clearLiveToolRefs();

			const payload = (await postSession({
				action: "restore_checkpoint",
				sessionId: activeSessionId,
				checkpointRunCount,
				config,
			})) as {
				sessionId?: string;
				messages?: ChatMessage[];
			};
			const nextSessionId =
				typeof payload.sessionId === "string" ? payload.sessionId.trim() : "";
			if (!nextSessionId) {
				throw new Error("Checkpoint restore did not return a new session id");
			}

			const nextMessages = Array.isArray(payload.messages)
				? (payload.messages as ChatMessage[])
				: await desktopClient.invoke<ChatMessage[]>("read_session_messages", {
						sessionId: nextSessionId,
						maxMessages: MAX_MESSAGES,
					});

			setSessionId(nextSessionId);
			activeSessionIdRef.current = nextSessionId;
			setMessages(nextMessages);
			setRawTranscript(
				nextMessages.map((message) => message.content).join("\n\n"),
			);
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
			const response = await postSession({ action: "stop", sessionId });
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

	const reset = useCallback(async () => {
		const activeSessionId = sessionId;
		if (activeSessionId) {
			try {
				await postSession({ action: "reset", sessionId: activeSessionId });
			} catch {
				// Best-effort reset path.
			}
		}
		setSessionId(null);
		setStatus("idle");
		setIsHydratingSession(false);
		setMessages([]);
		setRawTranscript("");
		setError(null);
		resetCounters();
		activeSessionIdRef.current = null;
		activeAssistantMessageIdRef.current = null;
		setActiveAssistantMessageId(null);
		setHydratedHistorySessionId(null);
		setPendingToolApprovals([]);
		setPromptsInQueue([]);
		clearLiveToolRefs();
	}, [sessionId, postSession, resetCounters, clearLiveToolRefs]);

	const hydrateSession = useCallback(
		async (session: SessionHistoryItem) => {
			const requestId = hydrationRequestIdRef.current + 1;
			hydrationRequestIdRef.current = requestId;
			setError(null);
			setStatus("starting");
			setIsHydratingSession(true);
			setSessionId(session.sessionId);
			setConfig((prev) => ({
				...prev,
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
			setPromptsInQueue([]);
			clearLiveToolRefs();

			const applyHydratedMessages = (
				msgs: ChatMessage[],
				sessionStatus: typeof session.status,
			) => {
				setMessages(msgs);
				setRawTranscript(msgs.map((m) => m.content).join("\n\n"));
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
				try {
					const transcript = await desktopClient.invoke<string>(
						"read_session_transcript",
						{ sessionId: session.sessionId, maxChars: 20000 },
					);
					const text = transcript.trim();
					if (text) {
						synthesized.push({
							id: makeId("history_assistant"),
							sessionId: session.sessionId,
							role: "assistant",
							content: text,
							createdAt: Date.now(),
						});
					}
				} catch {
					// Ignore transcript fallback failures.
				}
				void refreshPromptsInQueue(session.sessionId);
				applyHydratedMessages(synthesized, session.status);
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
			clearLiveToolRefs,
			refreshPromptsInQueue,
			refreshSessionDiffSummary,
			resetCounters,
		],
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

	const summary = useMemo(
		() => ({
			toolCalls,
			tokensIn,
			tokensOut,
			additions: diffSummary.additions,
			deletions: diffSummary.deletions,
		}),
		[
			diffSummary.additions,
			diffSummary.deletions,
			tokensIn,
			tokensOut,
			toolCalls,
		],
	);

	return {
		sessionId,
		status,
		chatTransportState,
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
		setConfig,
		start,
		hydrateSession,
		sendPrompt,
		steerPromptInQueue,
		approveToolApproval,
		rejectToolApproval,
		restoreCheckpoint,
		abort,
		stop: abort,
		reset,
	};
}
