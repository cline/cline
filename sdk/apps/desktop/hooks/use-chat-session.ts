"use client";

import * as Llms from "@clinebot/llms";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	type ChatMessage,
	type ChatSessionConfig,
	ChatSessionConfigSchema,
	type ChatSessionStatus,
} from "@/lib/chat-schema";

type ProcessContext = {
	workspaceRoot: string;
	cwd: string;
};

type ChatApiResult = {
	text: string;
	usage?: {
		inputTokens?: number;
		outputTokens?: number;
	};
	iterations?: number;
	finishReason?:
		| "completed"
		| "max_iterations"
		| "aborted"
		| "mistake_limit"
		| "error";
	toolCalls?: Array<{
		name: string;
		input?: unknown;
		output?: unknown;
		error?: string;
		durationMs?: number;
	}>;
};

type AgentChunkEvent = {
	sessionId: string;
	stream: string;
	chunk: string;
	ts: number;
};

type ChatWsResponseEvent = {
	type: "chat_response";
	requestId: string;
	response?: {
		sessionId?: string;
		result?: ChatApiResult;
		ok?: boolean;
	};
	error?: string;
};

type ChatWsChunkEvent = {
	type: "chat_event";
	event: AgentChunkEvent;
};

export const DEFAULT_CHAT_CONFIG: ChatSessionConfig = {
	workspaceRoot: "",
	cwd: "",
	provider: "cline",
	model:
		Llms.MODEL_COLLECTIONS_BY_PROVIDER_ID.cline?.provider.defaultModelId ??
		"anthropic/claude-sonnet-4.6",
	apiKey: "",
	systemPrompt: undefined,
	maxIterations: undefined,
	enableTools: true,
	enableSpawn: true,
	enableTeams: true,
	autoApproveTools: true,
	teamName: "desktop-team",
	missionStepInterval: 3,
	missionTimeIntervalMs: 120000,
};

function makeId(prefix: string): string {
	return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function makeRequestId(): string {
	return `chat_req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeRuntimeConfig(config: ChatSessionConfig): ChatSessionConfig {
	return {
		...config,
		enableSpawn: false,
		enableTeams: false,
	};
}

async function postSession(body: Record<string, unknown>) {
	const payload = (await invoke("chat_session_command", {
		request: body,
	})) as {
		error?: string;
		sessionId?: string;
		result?: {
			text: string;
			inputTokens?: number;
			outputTokens?: number;
			iterations?: number;
			finishReason?:
				| "completed"
				| "max_iterations"
				| "aborted"
				| "mistake_limit"
				| "error";
			toolCalls?: Array<{
				name: string;
				input?: unknown;
				output?: unknown;
				error?: string;
				durationMs?: number;
			}>;
		};
	};
	if (payload.error) {
		throw new Error(payload.error);
	}
	return payload;
}

export function useChatSession() {
	const wsRef = useRef<WebSocket | null>(null);
	const pendingWsRequestsRef = useRef(
		new Map<
			string,
			{
				resolve: (value: {
					error?: string;
					sessionId?: string;
					result?: ChatApiResult;
				}) => void;
				reject: (error: Error) => void;
			}
		>(),
	);
	const activeAssistantBySessionRef = useRef(new Map<string, string>());
	const [sessionId, setSessionId] = useState<string | null>(null);
	const [status, setStatus] = useState<ChatSessionStatus>("idle");
	const [config, setConfig] = useState<ChatSessionConfig>(DEFAULT_CHAT_CONFIG);
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [rawTranscript, setRawTranscript] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [toolCalls, setToolCalls] = useState(0);
	const [tokensIn, setTokensIn] = useState(0);
	const [tokensOut, setTokensOut] = useState(0);

	const addMessage = useCallback((message: ChatMessage) => {
		setMessages((prev) => [...prev, message].slice(-800));
	}, []);

	const replaceMessageContent = useCallback((id: string, content: string) => {
		setMessages((prev) =>
			prev.map((message) => {
				if (message.id !== id) {
					return message;
				}
				return {
					...message,
					content,
				};
			}),
		);
	}, []);

	const appendMessageContent = useCallback((id: string, chunk: string) => {
		if (!chunk) {
			return;
		}
		setMessages((prev) =>
			prev.map((message) => {
				if (message.id !== id) {
					return message;
				}
				return {
					...message,
					content: `${message.content}${chunk}`,
				};
			}),
		);
	}, []);

	const applyProcessContext = useCallback(async () => {
		try {
			const ctx = await invoke<ProcessContext>("get_process_context");
			setConfig((prev) => ({
				...prev,
				workspaceRoot: ctx.workspaceRoot,
				cwd: ctx.cwd || ctx.workspaceRoot,
			}));
		} catch {
			// Ignore in non-Tauri mode.
		}
	}, []);

	useEffect(() => {
		void applyProcessContext();
	}, [applyProcessContext]);

	useEffect(() => {
		let cancelled = false;
		let socket: WebSocket | null = null;

		const connect = async () => {
			let endpoint: string;
			try {
				endpoint = await invoke<string>("get_chat_ws_endpoint");
			} catch {
				return;
			}
			if (cancelled) {
				return;
			}
			socket = new WebSocket(endpoint);
			wsRef.current = socket;

			socket.onmessage = (event) => {
				if (typeof event.data !== "string") {
					return;
				}
				let parsed: ChatWsResponseEvent | ChatWsChunkEvent;
				try {
					parsed = JSON.parse(event.data) as
						| ChatWsResponseEvent
						| ChatWsChunkEvent;
				} catch {
					return;
				}

				if (parsed.type === "chat_response") {
					const pending = pendingWsRequestsRef.current.get(parsed.requestId);
					if (!pending) {
						return;
					}
					pendingWsRequestsRef.current.delete(parsed.requestId);
					if (parsed.error) {
						pending.reject(new Error(parsed.error));
						return;
					}
					pending.resolve({
						error: parsed.error,
						sessionId: parsed.response?.sessionId,
						result: parsed.response?.result,
					});
					return;
				}

				if (parsed.type === "chat_event") {
					const chunkEvent = parsed.event;
					if (chunkEvent.stream !== "chat_text") {
						return;
					}
					const assistantId = activeAssistantBySessionRef.current.get(
						chunkEvent.sessionId,
					);
					if (!assistantId) {
						return;
					}
					appendMessageContent(assistantId, chunkEvent.chunk);
					setRawTranscript((prev) => `${prev}${chunkEvent.chunk}`);
				}
			};

			socket.onclose = () => {
				if (wsRef.current === socket) {
					wsRef.current = null;
				}
				if (pendingWsRequestsRef.current.size > 0) {
					for (const [, pending] of pendingWsRequestsRef.current.entries()) {
						pending.reject(new Error("chat websocket disconnected"));
					}
					pendingWsRequestsRef.current.clear();
				}
			};
		};

		void connect();

		return () => {
			cancelled = true;
			if (socket) {
				socket.close();
			}
		};
	}, [appendMessageContent]);

	const postChatSession = useCallback(async (body: Record<string, unknown>) => {
		const socket = wsRef.current;
		if (socket && socket.readyState === WebSocket.OPEN) {
			const requestId = makeRequestId();
			const responsePromise = new Promise<{
				error?: string;
				sessionId?: string;
				result?: ChatApiResult;
			}>((resolve, reject) => {
				pendingWsRequestsRef.current.set(requestId, { resolve, reject });
			});
			socket.send(JSON.stringify({ requestId, request: body }));
			return await responsePromise;
		}
		return await postSession(body);
	}, []);

	const start = useCallback(
		async (nextConfig: ChatSessionConfig) => {
			const runtimeConfig = normalizeRuntimeConfig(nextConfig);
			const parsed = ChatSessionConfigSchema.safeParse(runtimeConfig);
			if (!parsed.success) {
				const message = parsed.error.issues
					.map((issue) => issue.message)
					.join(", ");
				setError(message);
				setStatus("error");
				return;
			}

			setError(null);
			setStatus("starting");
			setMessages([]);
			setRawTranscript("");
			setToolCalls(0);
			setTokensIn(0);
			setTokensOut(0);
			setConfig(parsed.data);

			try {
				const payload = await postChatSession({
					action: "start",
					config: parsed.data,
				});
				const id = payload.sessionId;
				if (!id) {
					throw new Error("Missing session id from server");
				}
				setSessionId(id);
				setStatus("running");
				addMessage({
					id: makeId("status"),
					sessionId: id,
					role: "status",
					content: `Session started: ${id}`,
					createdAt: Date.now(),
				});
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				setError(message);
				setStatus("error");
				addMessage({
					id: makeId("error"),
					sessionId: null,
					role: "error",
					content: message,
					createdAt: Date.now(),
				});
			}
		},
		[addMessage, postChatSession],
	);

	const sendPrompt = useCallback(
		async (prompt: string) => {
			const trimmed = prompt.trim();
			if (!trimmed) {
				return;
			}

			setError(null);
			let activeSessionId = sessionId;
			const runtimeConfig = normalizeRuntimeConfig(config);
			const parsed = ChatSessionConfigSchema.safeParse(runtimeConfig);
			if (!parsed.success) {
				const message = parsed.error.issues
					.map((issue) => issue.message)
					.join(", ");
				setError(message);
				setStatus("error");
				return;
			}

			if (!activeSessionId) {
				try {
					const payload = await postChatSession({
						action: "start",
						config: parsed.data,
					});
					const id = payload.sessionId;
					if (!id) {
						throw new Error("Missing session id from server");
					}
					activeSessionId = id;
					setSessionId(id);
					setStatus("running");
					setConfig(parsed.data);
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					setError(message);
					setStatus("error");
					addMessage({
						id: makeId("error"),
						sessionId: null,
						role: "error",
						content: message,
						createdAt: Date.now(),
					});
					return;
				}
			}

			const now = Date.now();
			addMessage({
				id: makeId("user"),
				sessionId: activeSessionId,
				role: "user",
				content: trimmed,
				createdAt: now,
			});

			const assistantId = makeId("assistant");
			if (!activeSessionId) {
				return;
			}
			activeAssistantBySessionRef.current.set(activeSessionId, assistantId);
			addMessage({
				id: assistantId,
				sessionId: activeSessionId,
				role: "assistant",
				content: "",
				createdAt: now + 1,
			});

			setStatus("starting");
			try {
				const payload = await postChatSession({
					action: "send",
					sessionId: activeSessionId,
					prompt: trimmed,
					config: parsed.data,
				});

				const result = payload.result as ChatApiResult | undefined;
				const assistantText = result?.text ?? "";
				replaceMessageContent(assistantId, assistantText);
				setRawTranscript((prev) => `${prev}${assistantText}`);

				const calls = result?.toolCalls ?? [];
				if (calls.length > 0) {
					setToolCalls((prev) => prev + calls.length);
					const baseTime = Date.now();
					setMessages((prev) => {
						const next = [...prev];
						for (let i = 0; i < calls.length; i += 1) {
							const call = calls[i];
							next.push({
								id: makeId("tool"),
								sessionId: activeSessionId,
								role: "tool",
								content: call.error
									? `[tool] ${call.name} failed: ${call.error}`
									: `[tool] ${call.name}`,
								createdAt: baseTime + i,
								meta: {
									toolName: call.name,
								},
							});
						}
						return next.slice(-800);
					});
				}

				if (typeof result?.usage?.inputTokens === "number") {
					setTokensIn((prev) => prev + (result.usage?.inputTokens ?? 0));
				}
				if (typeof result?.usage?.outputTokens === "number") {
					setTokensOut((prev) => prev + (result.usage?.outputTokens ?? 0));
				}

				if (result?.finishReason === "error") {
					setStatus("failed");
				} else if (result?.finishReason === "aborted") {
					setStatus("cancelled");
				} else {
					setStatus("running");
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				setError(message);
				setStatus("error");
				addMessage({
					id: makeId("error"),
					sessionId: activeSessionId,
					role: "error",
					content: message,
					createdAt: Date.now(),
				});
			} finally {
				activeAssistantBySessionRef.current.delete(activeSessionId);
			}
		},
		[addMessage, config, postChatSession, replaceMessageContent, sessionId],
	);

	const abort = useCallback(async () => {
		if (!sessionId) {
			return;
		}
		try {
			await postChatSession({ action: "abort", sessionId });
		} catch {
			// Best-effort abort path.
		}
		setStatus("cancelled");
	}, [postChatSession, sessionId]);

	const stop = useCallback(async () => {
		await abort();
	}, [abort]);

	const reset = useCallback(async () => {
		const activeSessionId = sessionId;
		if (activeSessionId) {
			try {
				await postChatSession({ action: "reset", sessionId: activeSessionId });
			} catch {
				// Best-effort reset path.
			}
		}
		setSessionId(null);
		setStatus("idle");
		setMessages([]);
		setRawTranscript("");
		setError(null);
		setToolCalls(0);
		setTokensIn(0);
		setTokensOut(0);
	}, [postChatSession, sessionId]);

	const summary = useMemo(
		() => ({
			toolCalls,
			tokensIn,
			tokensOut,
		}),
		[tokensIn, tokensOut, toolCalls],
	);

	return {
		sessionId,
		status,
		config,
		messages,
		rawTranscript,
		error,
		summary,
		setConfig,
		start,
		sendPrompt,
		abort,
		stop,
		reset,
	};
}
