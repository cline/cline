import type {
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
	PendingPromptsRuntimeService,
	RuntimeHost,
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
	readonly telemetry?: ITelemetryService;
	readonly sessionHost: RuntimeHost &
		Partial<PendingPromptsRuntimeService & SessionUsageRuntimeService>;
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

export async function readCoreSessionSnapshot(
	ctx: HubTransportContext,
	sessionId: string,
): Promise<CoreSessionSnapshot | undefined> {
	const session = await ctx.sessionHost.getSession(sessionId);
	if (!session) {
		return undefined;
	}
	const [messages, usageSummary] = await Promise.all([
		typeof ctx.sessionHost.readSessionMessages === "function"
			? ctx.sessionHost.readSessionMessages(sessionId)
			: [],
		ctx.sessionHost.getAccumulatedUsage?.(sessionId),
	]);
	return createCoreSessionSnapshot({
		session,
		messages,
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
