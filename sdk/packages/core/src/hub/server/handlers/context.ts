import type {
	AgentExtension,
	AgentTool,
	HubClientRecord,
	HubCommandEnvelope,
	HubEventEnvelope,
	HubReplyEnvelope,
	SessionRecord as HubSessionRecord,
	ITelemetryService,
	JsonValue,
	SessionParticipant,
} from "@cline/shared";
import { createSessionId } from "@cline/shared";
import type {
	CommandExecutionRuntimeService,
	PendingPromptsRuntimeService,
	RuntimeHost,
	SessionConnectionRuntimeService,
	SessionUsageRuntimeService,
} from "../../../runtime/host/runtime-host";
import {
	type CoreSessionSnapshot,
	createCoreSessionSnapshot,
} from "../../../session/session-snapshot";
import {
	type HubSessionState,
	toHubSessionRecord,
} from "../hub-session-records";

export type PendingApproval = {
	sessionId: string;
	resolve: (result: { approved: boolean; reason?: string }) => void;
	/**
	 * The `approval.requested` event as originally published. Pending
	 * approvals survive client disconnects, so a (re)subscribing client is
	 * re-issued this event instead of being left with a silently parked turn.
	 */
	requestedEvent?: HubEventEnvelope;
};

export type PendingCapabilityRequest = {
	sessionId: string;
	targetClientId: string;
	capabilityName: string;
	onProgress?: (payload: Record<string, unknown>) => void;
	resolve: (result: {
		ok: boolean;
		payload?: Record<string, unknown>;
		error?: string;
	}) => void;
};

/**
 * Shared mutable state and helpers passed to every command-handler module.
 * The transport class owns the maps; handlers get a stable read/write surface.
 */
export interface HubTransportContext {
	readonly clients: Map<string, HubClientRecord>;
	readonly sessionState: Map<string, HubSessionState>;
	readonly pendingApprovals: Map<string, PendingApproval>;
	readonly pendingCapabilityRequests: Map<string, PendingCapabilityRequest>;
	readonly suppressNextTerminalEventBySession: Map<string, string>;
	/**
	 * Count of RPC-driven turns (`run.start` / session input commands)
	 * currently awaiting `sessionHost.runTurn` per session. While > 0 the
	 * awaiting handler publishes the authoritative terminal run event, so the
	 * session-event projector must not publish its own `run.failed` for
	 * agent-level error events emitted during that turn. Turns drained from
	 * the pending-prompt queue run with no awaiting RPC handler (count 0), so
	 * the projector is their only failure reporter.
	 */
	readonly activeRpcTurnCountBySession: Map<string, number>;
	readonly telemetry?: ITelemetryService;
	/** Hub-owned tools injected into every local session runtime. */
	readonly sessionTools?: readonly AgentTool[];
	/** Hub-owned extensions injected into every local session runtime. */
	readonly sessionExtensions?: readonly AgentExtension[];
	readonly sessionHost: RuntimeHost &
		Partial<
			CommandExecutionRuntimeService &
				PendingPromptsRuntimeService &
				SessionUsageRuntimeService &
				SessionConnectionRuntimeService
		>;
	/**
	 * While draining, new mutating work (session.create, run.*) is refused
	 * with the retryable `hub_draining` error so the Hub can be replaced at a
	 * boundary an operator chose instead of being ambushed mid-turn.
	 * Optional: absent contexts (test fixtures) are never draining.
	 */
	isDraining?(): boolean;
	publish(event: HubEventEnvelope): void;
	buildEvent(
		event: HubEventEnvelope["event"],
		payload?: Record<string, unknown>,
		sessionId?: string,
	): HubEventEnvelope;
	requestCapability(
		sessionId: string,
		capabilityName: string,
		payload: Record<string, unknown>,
		targetClientId: string,
		onProgress?: (payload: Record<string, unknown>) => void,
	): Promise<Record<string, unknown> | undefined>;
}

type EnvelopeRef = Pick<HubCommandEnvelope, "version" | "requestId">;

export function okReply(
	envelope: EnvelopeRef,
	payload?: HubReplyEnvelope["payload"],
): HubReplyEnvelope {
	return {
		version: envelope.version,
		requestId: envelope.requestId,
		ok: true,
		...(payload !== undefined ? { payload } : {}),
	};
}

export function errorReply(
	envelope: EnvelopeRef,
	code: string,
	message: string,
): HubReplyEnvelope {
	return {
		version: envelope.version,
		requestId: envelope.requestId,
		ok: false,
		error: { code, message },
	};
}

/** Returns the value when it's a plain object, or undefined otherwise. */
export function asPlainRecord(
	value: unknown,
): Record<string, JsonValue | undefined> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, JsonValue | undefined>)
		: undefined;
}

/**
 * Pulls the session id from the envelope. Handlers accept either
 * `payload.sessionId` (top-level command argument) or `envelope.sessionId`
 * (envelope-level addressing). Returns "" when neither is present so handlers
 * can branch on truthiness.
 */
export function extractSessionId(envelope: HubCommandEnvelope): string {
	if (typeof envelope.payload?.sessionId === "string") {
		return envelope.payload.sessionId.trim();
	}
	return envelope.sessionId?.trim() ?? "";
}

export function buildHubEvent(
	event: HubEventEnvelope["event"],
	payload?: Record<string, unknown>,
	sessionId?: string,
): HubEventEnvelope {
	return {
		version: "v1",
		event,
		eventId: createSessionId("hevt_"),
		sessionId,
		timestamp: Date.now(),
		payload,
	};
}

export async function readHubSessionRecord(
	ctx: HubTransportContext,
	sessionId: string,
): Promise<HubSessionRecord | undefined> {
	const session = await ctx.sessionHost.getSession(sessionId);
	if (!session) {
		return undefined;
	}
	const usageSummary = await ctx.sessionHost.getAccumulatedUsage?.(sessionId);
	return toHubSessionRecord(
		session,
		ctx.sessionState.get(sessionId),
		usageSummary?.usage,
		usageSummary?.aggregateUsage,
	);
}

/**
 * Builds the snapshot that rides on hub events and command replies. It is a
 * state notification — status, usage, model, workspace, checkpoint — and
 * deliberately does NOT read the transcript: `snapshot.messages` here would
 * put the entire conversation on every status flip, for every subscriber,
 * and into the durable event log (observed in the wild as a 25GB hub process
 * feeding a slow reader). Anything that needs messages fetches them with the
 * `session.messages` command.
 */
export async function readCoreSessionSnapshot(
	ctx: HubTransportContext,
	sessionId: string,
): Promise<CoreSessionSnapshot | undefined> {
	const session = await ctx.sessionHost.getSession(sessionId);
	if (!session) {
		return undefined;
	}
	const usageSummary = await ctx.sessionHost.getAccumulatedUsage?.(sessionId);
	return createCoreSessionSnapshot({
		session,
		usage: usageSummary?.usage,
		aggregateUsage: usageSummary?.aggregateUsage,
	});
}

export function ensureSessionState(
	ctx: HubTransportContext,
	sessionId: string,
	clientId: string,
	role: SessionParticipant["role"],
	options: { interactive?: boolean } = {},
): HubSessionState {
	const existing = ctx.sessionState.get(sessionId);
	if (existing) {
		if (options.interactive !== undefined) {
			existing.interactive = options.interactive;
		}
		if (role === "creator" && !existing.createdByClientId) {
			existing.createdByClientId = clientId;
		}
		if (!existing.participants.has(clientId)) {
			existing.participants.set(clientId, {
				clientId,
				attachedAt: Date.now(),
				role,
			});
		}
		return existing;
	}
	const state: HubSessionState = {
		createdByClientId: clientId,
		interactive: options.interactive ?? true,
		participants: new Map([
			[
				clientId,
				{
					clientId,
					attachedAt: Date.now(),
					role,
				},
			],
		]),
	};
	ctx.sessionState.set(sessionId, state);
	return state;
}

export function ensureSessionParticipant(
	ctx: HubTransportContext,
	sessionId: string,
	clientId: string,
	role: SessionParticipant["role"],
	options: { interactive?: boolean } = {},
): HubSessionState {
	const existing = ctx.sessionState.get(sessionId);
	if (existing) {
		if (options.interactive !== undefined) {
			existing.interactive = options.interactive;
		}
		if (!existing.participants.has(clientId)) {
			existing.participants.set(clientId, {
				clientId,
				attachedAt: Date.now(),
				role,
			});
		}
		return existing;
	}
	const state: HubSessionState = {
		interactive: options.interactive ?? true,
		participants: new Map([
			[
				clientId,
				{
					clientId,
					attachedAt: Date.now(),
					role,
				},
			],
		]),
	};
	ctx.sessionState.set(sessionId, state);
	return state;
}
