import type { ChatMessage } from "@/lib/chat-schema";

/**
 * Pure reducer that folds live hub event envelopes (broadcast by the sidecar
 * as `cloud_session_event`) into renderable chat state. Kept free of React so
 * the streaming behavior is unit-testable.
 */

export type CloudApprovalRequest = {
	requestId: string;
	sessionId: string;
	createdAt: string;
	toolCallId: string;
	toolName: string;
	input?: unknown;
	iteration?: number;
};

export type CloudRunStatus =
	| "idle"
	| "running"
	| "completed"
	| "aborted"
	| "failed";

export type CloudUsageTotals = {
	inputTokens: number;
	outputTokens: number;
	totalCost: number;
};

export type CloudChatState = {
	messages: ChatMessage[];
	/** Message id currently receiving assistant text/reasoning deltas. */
	streamingAssistantId: string | null;
	runStatus: CloudRunStatus;
	pendingApprovals: CloudApprovalRequest[];
	usageTotals: CloudUsageTotals | null;
	lastError: string | null;
};

export function createCloudChatState(
	messages: ChatMessage[] = [],
	agentStatus?: string | null,
): CloudChatState {
	return {
		messages,
		streamingAssistantId: null,
		runStatus: agentStatus === "running" ? "running" : "idle",
		pendingApprovals: [],
		usageTotals: null,
		lastError: null,
	};
}

type JsonRecord = Record<string, unknown>;

export type CloudSessionEventPayload = {
	event: string;
	agentSessionId: string | null;
	payload: JsonRecord | null;
};

let cloudMessageCounter = 0;

function nextMessageId(prefix: string): string {
	cloudMessageCounter += 1;
	return `${prefix}_${Date.now()}_${cloudMessageCounter}`;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value ? value : undefined;
}

function asNumber(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function buildToolContent(
	toolName: string,
	input: unknown,
	result: unknown,
	isError: boolean,
): string {
	return JSON.stringify({ toolName, input, result, isError });
}

function appendMessage(
	state: CloudChatState,
	message: ChatMessage,
): CloudChatState {
	return { ...state, messages: [...state.messages, message] };
}

function updateMessage(
	state: CloudChatState,
	messageId: string,
	update: (message: ChatMessage) => ChatMessage,
): CloudChatState {
	return {
		...state,
		messages: state.messages.map((message) =>
			message.id === messageId ? update(message) : message,
		),
	};
}

function ensureStreamingAssistant(
	state: CloudChatState,
	agentSessionId: string | null,
): { state: CloudChatState; messageId: string } {
	if (state.streamingAssistantId) {
		return { state, messageId: state.streamingAssistantId };
	}
	const messageId = nextMessageId("cloud_assistant");
	const message: ChatMessage = {
		id: messageId,
		sessionId: agentSessionId,
		role: "assistant",
		content: "",
		createdAt: Date.now(),
	};
	return {
		state: {
			...appendMessage(state, message),
			streamingAssistantId: messageId,
		},
		messageId,
	};
}

/** Appends a locally sent prompt so the UI reflects it immediately. */
export function appendOptimisticUserMessage(
	state: CloudChatState,
	prompt: string,
	agentSessionId: string | null,
): CloudChatState {
	return {
		...appendMessage(state, {
			id: nextMessageId("cloud_user"),
			sessionId: agentSessionId,
			role: "user",
			content: prompt,
			createdAt: Date.now(),
		}),
		runStatus: "running",
		lastError: null,
		streamingAssistantId: null,
	};
}

export function applyCloudSessionEvent(
	state: CloudChatState,
	event: CloudSessionEventPayload,
): CloudChatState {
	const payload = event.payload ?? {};
	switch (event.event) {
		case "run.started":
			return { ...state, runStatus: "running", lastError: null };

		case "assistant.delta": {
			const text = asString(payload.text);
			if (!text) {
				return state;
			}
			const ensured = ensureStreamingAssistant(state, event.agentSessionId);
			return updateMessage(ensured.state, ensured.messageId, (message) => ({
				...message,
				content: message.content + text,
			}));
		}

		case "assistant.finished": {
			const text = asString(payload.text);
			if (!state.streamingAssistantId) {
				// A finished block without deltas (e.g. reconnect race): render it
				// as one complete message.
				if (!text) {
					return state;
				}
				return appendMessage(state, {
					id: nextMessageId("cloud_assistant"),
					sessionId: event.agentSessionId,
					role: "assistant",
					content: text,
					createdAt: Date.now(),
				});
			}
			const messageId = state.streamingAssistantId;
			const next = text
				? updateMessage(state, messageId, (message) => ({
						...message,
						content: text,
					}))
				: state;
			return { ...next, streamingAssistantId: null };
		}

		case "reasoning.delta": {
			const text = asString(payload.text) ?? "";
			const redacted = payload.redacted === true;
			if (!text && !redacted) {
				return state;
			}
			const ensured = ensureStreamingAssistant(state, event.agentSessionId);
			return updateMessage(ensured.state, ensured.messageId, (message) => ({
				...message,
				reasoning: (message.reasoning ?? "") + text,
				...(redacted ? { reasoningRedacted: true } : {}),
			}));
		}

		case "reasoning.finished": {
			const reasoning = asString(payload.reasoning);
			if (!reasoning || !state.streamingAssistantId) {
				return state;
			}
			return updateMessage(state, state.streamingAssistantId, (message) => ({
				...message,
				reasoning,
			}));
		}

		case "tool.started": {
			const toolName = asString(payload.toolName) ?? "tool_call";
			const toolCallId = asString(payload.toolCallId) ?? "";
			const messageId = toolCallId
				? `cloud_tool_${toolCallId}`
				: nextMessageId("cloud_tool");
			// A tool call ends the current assistant text segment; the next
			// delta starts a fresh bubble below the tool row.
			const next: CloudChatState = { ...state, streamingAssistantId: null };
			return appendMessage(next, {
				id: messageId,
				sessionId: event.agentSessionId,
				role: "tool",
				content: buildToolContent(toolName, payload.input ?? null, null, false),
				createdAt: Date.now(),
				meta: { toolName, hookEventName: "tool_call" },
			});
		}

		case "tool.finished": {
			const toolName = asString(payload.toolName) ?? "tool_call";
			const toolCallId = asString(payload.toolCallId) ?? "";
			const isError = Boolean(payload.error);
			const result = payload.error ?? payload.output ?? null;
			const messageId = toolCallId ? `cloud_tool_${toolCallId}` : null;
			const existing = messageId
				? state.messages.find((message) => message.id === messageId)
				: undefined;
			if (existing && messageId) {
				return updateMessage(state, messageId, (message) => {
					let input: unknown = null;
					try {
						input = (JSON.parse(message.content) as JsonRecord).input ?? null;
					} catch {
						// Keep null input when the started payload was not recorded.
					}
					return {
						...message,
						content: buildToolContent(toolName, input, result, isError),
						meta: { ...message.meta, toolName, hookEventName: "tool_result" },
					};
				});
			}
			return appendMessage(
				{ ...state, streamingAssistantId: null },
				{
					id: messageId ?? nextMessageId("cloud_tool"),
					sessionId: event.agentSessionId,
					role: "tool",
					content: buildToolContent(toolName, null, result, isError),
					createdAt: Date.now(),
					meta: { toolName, hookEventName: "tool_result" },
				},
			);
		}

		case "session.notice": {
			const message = asString(payload.message);
			if (!message) {
				return state;
			}
			const displayRole = asString(payload.displayRole);
			return appendMessage(state, {
				id: nextMessageId("cloud_notice"),
				sessionId: event.agentSessionId,
				role: "status",
				content: message,
				createdAt: Date.now(),
				meta: {
					...(displayRole ? { displayRole } : {}),
					...(asString(payload.reason)
						? { reason: asString(payload.reason) }
						: {}),
					messageKind: asString(payload.noticeType),
				},
			});
		}

		case "usage.updated": {
			const totals =
				payload.totals && typeof payload.totals === "object"
					? (payload.totals as JsonRecord)
					: null;
			if (!totals) {
				return state;
			}
			return {
				...state,
				usageTotals: {
					inputTokens: asNumber(totals.inputTokens),
					outputTokens: asNumber(totals.outputTokens),
					totalCost: asNumber(totals.totalCost),
				},
			};
		}

		case "approval.requested": {
			const approvalId = asString(payload.approvalId);
			if (!approvalId) {
				return state;
			}
			if (
				state.pendingApprovals.some(
					(approval) => approval.requestId === approvalId,
				)
			) {
				return state;
			}
			return {
				...state,
				pendingApprovals: [
					...state.pendingApprovals,
					{
						requestId: approvalId,
						sessionId:
							asString(payload.sessionId) ?? event.agentSessionId ?? "",
						createdAt: new Date().toISOString(),
						toolCallId: asString(payload.toolCallId) ?? approvalId,
						toolName: asString(payload.toolName) ?? "tool_call",
						input: parseApprovalInput(payload),
						iteration:
							typeof payload.iteration === "number"
								? payload.iteration
								: undefined,
					},
				],
			};
		}

		case "approval.resolved": {
			const approvalId = asString(payload.approvalId);
			if (!approvalId) {
				return state;
			}
			return {
				...state,
				pendingApprovals: state.pendingApprovals.filter(
					(approval) => approval.requestId !== approvalId,
				),
			};
		}

		case "run.completed":
			return {
				...state,
				runStatus: "completed",
				streamingAssistantId: null,
				pendingApprovals: [],
			};

		case "run.aborted":
			return {
				...state,
				runStatus: "aborted",
				streamingAssistantId: null,
				pendingApprovals: [],
			};

		case "run.failed": {
			const error = asString(payload.error) ?? asString(payload.reason) ?? null;
			return {
				...state,
				runStatus: "failed",
				streamingAssistantId: null,
				pendingApprovals: [],
				lastError: error,
			};
		}

		default:
			return state;
	}
}

function parseApprovalInput(payload: JsonRecord): unknown {
	if (payload.input !== undefined) {
		return payload.input;
	}
	const inputJson = asString(payload.inputJson);
	if (!inputJson) {
		return undefined;
	}
	try {
		return JSON.parse(inputJson);
	} catch {
		return inputJson;
	}
}
