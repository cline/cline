import type {
	AgentEvent,
	AgentFinishReason,
	AgentUsage,
	HubEventEnvelope,
	SessionRecord as HubSessionRecord,
} from "@cline/shared";
import { isGeneratedMedia } from "@cline/shared";
import type { CoreSessionSnapshot } from "../../session/session-snapshot";
import { isNonTerminalSessionStatus } from "../../types/common";
import type {
	CoreSessionEvent,
	SessionPendingPrompt,
} from "../../types/events";

/**
 * Hub envelope kinds the projector never maps. They require host-owned side
 * effects (capability execution, approval decisions) and are answered by the
 * runtime host that owns the Hub connection.
 */
export const HOST_OWNED_HUB_EVENTS = [
	"capability.requested",
	"capability.resolved",
	"approval.requested",
] as const;

export type HostOwnedHubEvent = (typeof HOST_OWNED_HUB_EVENTS)[number];

export function isHostOwnedHubEvent(
	eventName: string,
): eventName is HostOwnedHubEvent {
	return (HOST_OWNED_HUB_EVENTS as readonly string[]).includes(eventName);
}

/**
 * Per-session projection state. It exists only to deduplicate terminal
 * events and to suppress a second tool `content_start` for tool calls the
 * host already announced while requesting approval.
 */
export interface HubEventProjectionSessionState {
	/** `agent.done`/`run.*` terminal events collapse into one `done` per run. */
	doneEmittedForCurrentRun: boolean;
	/** Tool call ids whose `content_start` was already emitted via approval. */
	announcedToolCallIds: Set<string>;
}

export function createHubEventProjectionSessionState(): HubEventProjectionSessionState {
	return {
		doneEmittedForCurrentRun: false,
		announcedToolCallIds: new Set(),
	};
}

export interface HubEventProjectorOptions {
	/** Clock used for `ended.ts` when the envelope carries no timestamp. */
	now?: () => number;
}

export interface HubEventProjector {
	/**
	 * Project one reconciled Hub envelope into zero or more `CoreSessionEvent`s
	 * delivered through `onEvent`.
	 *
	 * Returns `false` when the envelope is host-owned (see
	 * {@link HOST_OWNED_HUB_EVENTS}) so the caller can execute its own
	 * capability/approval handling; returns `true` otherwise, including for
	 * envelopes that intentionally project to nothing.
	 */
	handle(event: HubEventEnvelope): boolean;
	/**
	 * Emit a tool `content_start` for a tool call announced out-of-band (the
	 * host does this while requesting local approval) and remember the id so
	 * the matching `tool.started` envelope does not emit a second start.
	 */
	announceToolCall(input: {
		sessionId: string;
		toolCallId?: string;
		toolName?: string;
		toolInput?: unknown;
	}): void;
	/** Read-only view of a session's projection state (mainly for tests). */
	getSessionState(
		sessionId: string,
	): Readonly<HubEventProjectionSessionState> | undefined;
	/**
	 * Drop projection state for one session, or for every session when no id
	 * is given. Call this when an authoritative snapshot replaces the stream
	 * baseline so a later terminal event is not treated as a duplicate.
	 */
	reset(sessionId?: string): void;
	/** Clear all state and ignore any further envelopes. */
	dispose(): void;
}

export function parseCoreSessionSnapshot(
	value: unknown,
): CoreSessionSnapshot | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}
	const snapshot = value as Partial<CoreSessionSnapshot>;
	return snapshot.version === 1 && typeof snapshot.sessionId === "string"
		? (JSON.parse(JSON.stringify(snapshot)) as CoreSessionSnapshot)
		: undefined;
}

function isAgentFinishReason(value: unknown): value is AgentFinishReason {
	return (
		value === "completed" ||
		value === "max_iterations" ||
		value === "aborted" ||
		value === "mistake_limit" ||
		value === "error"
	);
}

function parseDoneUsage(value: unknown): AgentUsage | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}
	const payload = value as Record<string, unknown>;
	const inputTokens =
		typeof payload.inputTokens === "number" ? payload.inputTokens : undefined;
	const outputTokens =
		typeof payload.outputTokens === "number" ? payload.outputTokens : undefined;
	if (inputTokens === undefined || outputTokens === undefined) {
		return undefined;
	}
	return {
		inputTokens,
		outputTokens,
		cacheReadTokens:
			typeof payload.cacheReadTokens === "number" ? payload.cacheReadTokens : 0,
		cacheWriteTokens:
			typeof payload.cacheWriteTokens === "number"
				? payload.cacheWriteTokens
				: 0,
		totalCost: typeof payload.totalCost === "number" ? payload.totalCost : 0,
	};
}

function finiteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function usageMetric(
	record: Record<string, unknown> | undefined,
	key: string,
): number {
	return finiteNumber(record?.[key]) ?? 0;
}

export function usageEventFromPayload(
	payload: Record<string, unknown> | undefined,
): {
	event: Extract<AgentEvent, { type: "usage" }>;
	teamAgentId?: string;
	teamRole?: "lead" | "teammate";
} {
	const delta =
		payload?.delta && typeof payload.delta === "object"
			? (payload.delta as Record<string, unknown>)
			: undefined;
	const totals =
		payload?.totals && typeof payload.totals === "object"
			? (payload.totals as Record<string, unknown>)
			: undefined;
	const agent =
		payload?.agent && typeof payload.agent === "object"
			? (payload.agent as Record<string, unknown>)
			: undefined;
	const teamRole =
		agent?.teamRole === "teammate" || agent?.teamRole === "lead"
			? agent.teamRole
			: undefined;
	return {
		event: {
			type: "usage",
			agentId: typeof agent?.agentId === "string" ? agent.agentId : undefined,
			conversationId:
				typeof agent?.conversationId === "string"
					? agent.conversationId
					: undefined,
			parentAgentId:
				typeof agent?.parentAgentId === "string"
					? agent.parentAgentId
					: undefined,
			inputTokens: usageMetric(delta, "inputTokens"),
			outputTokens: usageMetric(delta, "outputTokens"),
			cacheReadTokens: usageMetric(delta, "cacheReadTokens"),
			cacheWriteTokens: usageMetric(delta, "cacheWriteTokens"),
			cost: finiteNumber(delta?.totalCost),
			totalInputTokens: usageMetric(totals, "inputTokens"),
			totalOutputTokens: usageMetric(totals, "outputTokens"),
			totalCacheReadTokens: usageMetric(totals, "cacheReadTokens"),
			totalCacheWriteTokens: usageMetric(totals, "cacheWriteTokens"),
			totalCost: finiteNumber(totals?.totalCost),
		},
		teamAgentId:
			typeof agent?.teamAgentId === "string" ? agent.teamAgentId : undefined,
		teamRole,
	};
}

export function doneEventFromPayload(
	payload: Record<string, unknown> | undefined,
): AgentEvent {
	const result =
		payload?.result &&
		typeof payload.result === "object" &&
		!Array.isArray(payload.result)
			? (payload.result as Record<string, unknown>)
			: undefined;
	const reasonCandidate = payload?.reason ?? result?.finishReason;
	const reason = isAgentFinishReason(reasonCandidate)
		? reasonCandidate
		: reasonCandidate === "failed"
			? "error"
			: "completed";
	const usage = parseDoneUsage(payload?.usage ?? result?.usage);
	return {
		type: "done",
		reason,
		text:
			typeof payload?.text === "string"
				? payload.text
				: typeof result?.text === "string"
					? result.text
					: "",
		iterations:
			typeof payload?.iterations === "number"
				? payload.iterations
				: typeof result?.iterations === "number"
					? result.iterations
					: 0,
		usage,
	};
}

function toolCallContentStart(input: {
	sessionId: string;
	toolCallId?: string;
	toolName?: string;
	toolInput?: unknown;
}): CoreSessionEvent {
	return {
		type: "agent_event",
		payload: {
			sessionId: input.sessionId,
			event: {
				type: "content_start",
				contentType: "tool",
				toolCallId: input.toolCallId,
				toolName: input.toolName,
				input: input.toolInput,
			},
		},
	};
}

function doneEventIfNeeded(
	state: HubEventProjectionSessionState,
	sessionId: string,
	payload: Record<string, unknown> | undefined,
): CoreSessionEvent[] {
	if (state.doneEmittedForCurrentRun) {
		return [];
	}
	state.doneEmittedForCurrentRun = true;
	return [
		{
			type: "agent_event",
			payload: { sessionId, event: doneEventFromPayload(payload) },
		},
	];
}

/**
 * Pure mapping step: project one non-host-owned envelope for `sessionId`
 * into `CoreSessionEvent`s, mutating `state` for dedup bookkeeping.
 */
export function projectHubEnvelope(
	event: HubEventEnvelope,
	sessionId: string,
	state: HubEventProjectionSessionState,
	options: { now: () => number },
): CoreSessionEvent[] {
	switch (event.event) {
		case "run.started": {
			state.doneEmittedForCurrentRun = false;
			const snapshot = parseCoreSessionSnapshot(event.payload?.snapshot);
			const session = event.payload?.session as HubSessionRecord | undefined;
			const events: CoreSessionEvent[] = [];
			if (snapshot) {
				events.push({
					type: "session_snapshot",
					payload: { sessionId, snapshot },
				});
			}
			events.push({
				type: "status",
				payload: { sessionId, status: session?.status ?? "running" },
			});
			return events;
		}
		case "iteration.started": {
			return [
				{
					type: "agent_event",
					payload: {
						sessionId,
						event: {
							type: "iteration_start",
							iteration:
								typeof event.payload?.iteration === "number"
									? event.payload.iteration
									: 0,
						},
					},
				},
			];
		}
		case "iteration.finished": {
			return [
				{
					type: "agent_event",
					payload: {
						sessionId,
						event: {
							type: "iteration_end",
							iteration:
								typeof event.payload?.iteration === "number"
									? event.payload.iteration
									: 0,
							hadToolCalls: event.payload?.hadToolCalls === true,
							toolCallCount:
								typeof event.payload?.toolCallCount === "number"
									? event.payload.toolCallCount
									: 0,
						},
					},
				},
			];
		}
		case "session.notice": {
			const noticeType = event.payload?.noticeType;
			const displayRole = event.payload?.displayRole;
			const reason = event.payload?.reason;
			const agent =
				event.payload?.agent && typeof event.payload.agent === "object"
					? (event.payload.agent as Record<string, unknown>)
					: undefined;
			const teamRole =
				agent?.teamRole === "lead" || agent?.teamRole === "teammate"
					? agent.teamRole
					: undefined;
			return [
				{
					type: "agent_event",
					payload: {
						sessionId,
						...(teamRole ? { teamRole } : {}),
						...(typeof agent?.teamAgentId === "string"
							? { teamAgentId: agent.teamAgentId }
							: {}),
						event: {
							type: "notice",
							...(typeof agent?.agentId === "string"
								? { agentId: agent.agentId }
								: {}),
							...(typeof agent?.conversationId === "string"
								? { conversationId: agent.conversationId }
								: {}),
							...(typeof agent?.parentAgentId === "string"
								? { parentAgentId: agent.parentAgentId }
								: {}),
							noticeType:
								noticeType === "recovery" || noticeType === "stop"
									? noticeType
									: "status",
							message:
								typeof event.payload?.message === "string"
									? event.payload.message
									: "",
							...(displayRole === "system" || displayRole === "status"
								? { displayRole }
								: {}),
							...(typeof reason === "string"
								? { reason: reason as never }
								: {}),
							...(event.payload?.metadata &&
							typeof event.payload.metadata === "object"
								? {
										metadata: event.payload.metadata as Record<string, unknown>,
									}
								: {}),
						},
					},
				},
			];
		}
		case "assistant.delta": {
			const text =
				typeof event.payload?.text === "string" ? event.payload.text : "";
			if (!text) {
				return [];
			}
			return [
				{
					type: "agent_event",
					payload: {
						sessionId,
						event: { type: "content_start", contentType: "text", text },
					},
				},
			];
		}
		case "assistant.media": {
			const media =
				event.payload?.media &&
				typeof event.payload.media === "object" &&
				!Array.isArray(event.payload.media)
					? (event.payload.media as Record<string, unknown>)
					: undefined;
			if (!isGeneratedMedia(media)) {
				return [];
			}
			return [
				{
					type: "agent_event",
					payload: {
						sessionId,
						event: { type: "content_end", contentType: "media", media },
					},
				},
			];
		}
		case "assistant.finished": {
			return [
				{
					type: "agent_event",
					payload: {
						sessionId,
						event: {
							type: "content_end",
							contentType: "text",
							text:
								typeof event.payload?.text === "string"
									? event.payload.text
									: undefined,
						},
					},
				},
			];
		}
		case "reasoning.delta": {
			const text =
				typeof event.payload?.text === "string" ? event.payload.text : "";
			const redacted = event.payload?.redacted === true;
			if (!text && !redacted) {
				return [];
			}
			return [
				{
					type: "agent_event",
					payload: {
						sessionId,
						event: {
							type: "content_start",
							contentType: "reasoning",
							reasoning: text,
							redacted,
						},
					},
				},
			];
		}
		case "reasoning.finished": {
			return [
				{
					type: "agent_event",
					payload: {
						sessionId,
						event: {
							type: "content_end",
							contentType: "reasoning",
							reasoning:
								typeof event.payload?.reasoning === "string"
									? event.payload.reasoning
									: undefined,
						},
					},
				},
			];
		}
		case "agent.done": {
			return doneEventIfNeeded(state, sessionId, event.payload);
		}
		case "usage.updated": {
			const usage = usageEventFromPayload(event.payload);
			return [
				{
					type: "agent_event",
					payload: {
						sessionId,
						event: usage.event,
						teamAgentId: usage.teamAgentId,
						teamRole: usage.teamRole,
					},
				},
			];
		}
		case "tool.started": {
			const toolCallId =
				typeof event.payload?.toolCallId === "string"
					? event.payload.toolCallId
					: undefined;
			if (toolCallId && state.announcedToolCallIds.delete(toolCallId)) {
				return [];
			}
			return [
				toolCallContentStart({
					sessionId,
					toolCallId,
					toolName:
						typeof event.payload?.toolName === "string"
							? event.payload.toolName
							: undefined,
					toolInput: event.payload?.input,
				}),
			];
		}
		case "tool.updated": {
			return [
				{
					type: "agent_event",
					payload: {
						sessionId,
						event: {
							type: "content_update",
							contentType: "tool",
							toolCallId:
								typeof event.payload?.toolCallId === "string"
									? event.payload.toolCallId
									: undefined,
							toolName:
								typeof event.payload?.toolName === "string"
									? event.payload.toolName
									: undefined,
							update: event.payload?.update,
						},
					},
				},
			];
		}
		case "tool.finished": {
			const toolCallId =
				typeof event.payload?.toolCallId === "string"
					? event.payload.toolCallId
					: undefined;
			if (toolCallId) {
				state.announcedToolCallIds.delete(toolCallId);
			}
			return [
				{
					type: "agent_event",
					payload: {
						sessionId,
						event: {
							type: "content_end",
							contentType: "tool",
							toolCallId,
							toolName:
								typeof event.payload?.toolName === "string"
									? event.payload.toolName
									: undefined,
							output: event.payload?.output,
							error:
								typeof event.payload?.error === "string"
									? event.payload.error
									: undefined,
						},
					},
				},
			];
		}
		case "session.created":
		case "session.updated":
		case "session.attached":
		case "session.detached": {
			const snapshot = parseCoreSessionSnapshot(event.payload?.snapshot);
			const session = event.payload?.session as HubSessionRecord | undefined;
			const events: CoreSessionEvent[] = [];
			if (snapshot) {
				events.push({
					type: "session_snapshot",
					payload: { sessionId, snapshot },
				});
			}
			// Snapshot-only session.updated events (persistence updates)
			// carry no session record and can trail a turn's final idle
			// update. Defaulting them to "running" flipped clients back to
			// busy after the turn had finished — for queue-drained turns
			// nothing else owns the busy flag, so it stuck forever (e.g.
			// the desktop's workspace-restore gate). Report the snapshot's
			// real status, or nothing when neither source has one.
			const status = session?.status ?? snapshot?.status;
			if (status) {
				events.push({ type: "status", payload: { sessionId, status } });
			}
			return events;
		}
		case "session.pending_prompts": {
			return [
				{
					type: "pending_prompts",
					payload: {
						sessionId,
						prompts: Array.isArray(event.payload?.prompts)
							? (event.payload.prompts as SessionPendingPrompt[])
							: [],
					},
				},
			];
		}
		case "session.pending_prompt_submitted": {
			const prompt = event.payload?.prompt as SessionPendingPrompt | undefined;
			if (!prompt) {
				return [];
			}
			return [
				{
					type: "pending_prompt_submitted",
					payload: {
						sessionId,
						id: prompt.id,
						prompt: prompt.prompt,
						delivery: prompt.delivery,
						attachmentCount: prompt.attachmentCount,
						userImages: prompt.userImages,
						userFiles: prompt.userFiles,
					},
				},
			];
		}
		case "run.completed":
		case "run.failed":
		case "run.aborted": {
			const snapshot = parseCoreSessionSnapshot(event.payload?.snapshot);
			const reason =
				typeof event.payload?.reason === "string"
					? event.payload.reason
					: event.event === "run.aborted"
						? "aborted"
						: event.event === "run.failed"
							? "error"
							: "completed";
			const events = doneEventIfNeeded(state, sessionId, {
				...event.payload,
				reason,
			});
			if (
				snapshot?.interactive === true &&
				isNonTerminalSessionStatus(snapshot.status)
			) {
				return events;
			}
			events.push({
				type: "ended",
				payload: {
					sessionId,
					reason,
					ts: event.timestamp ?? options.now(),
				},
			});
			return events;
		}
		default:
			return [];
	}
}

/**
 * Create a stateful projector that maps reconciled Hub envelopes to
 * `CoreSessionEvent`s. The projector never sends Hub commands and never makes
 * tool or approval decisions; it only maps and deduplicates.
 */
export function createHubEventProjector(
	onEvent: (event: CoreSessionEvent) => void,
	options: HubEventProjectorOptions = {},
): HubEventProjector {
	const now = options.now ?? (() => Date.now());
	const sessions = new Map<string, HubEventProjectionSessionState>();
	let disposed = false;

	const stateFor = (sessionId: string): HubEventProjectionSessionState => {
		let state = sessions.get(sessionId);
		if (!state) {
			state = createHubEventProjectionSessionState();
			sessions.set(sessionId, state);
		}
		return state;
	};

	return {
		handle(event) {
			if (isHostOwnedHubEvent(event.event)) {
				return false;
			}
			if (disposed) {
				return true;
			}
			const sessionId = event.sessionId?.trim();
			if (!sessionId) {
				return true;
			}
			const projected = projectHubEnvelope(
				event,
				sessionId,
				stateFor(sessionId),
				{ now },
			);
			for (const projectedEvent of projected) {
				onEvent(projectedEvent);
			}
			return true;
		},
		announceToolCall(input) {
			if (disposed) {
				return;
			}
			const sessionId = input.sessionId.trim();
			if (!sessionId) {
				return;
			}
			if (input.toolCallId) {
				stateFor(sessionId).announcedToolCallIds.add(input.toolCallId);
			}
			onEvent(toolCallContentStart({ ...input, sessionId }));
		},
		getSessionState(sessionId) {
			return sessions.get(sessionId.trim());
		},
		reset(sessionId) {
			if (sessionId === undefined) {
				sessions.clear();
				return;
			}
			sessions.delete(sessionId.trim());
		},
		dispose() {
			disposed = true;
			sessions.clear();
		},
	};
}
