import type {
	HubClientRecord,
	HubCommandEnvelope,
	HubEventEnvelope,
	HubReplyEnvelope,
	SessionRecord as HubSessionRecord,
	JsonValue,
	SessionParticipant,
} from "@clinebot/shared";
import { createSessionId } from "@clinebot/shared";
import type { RuntimeHost } from "../../../runtime/host/runtime-host";
import { type HubSessionState, toHubSessionRecord } from "../helpers";

export type PendingApproval = {
	sessionId: string;
	resolve: (result: { approved: boolean; reason?: string }) => void;
};

export type PendingCapabilityRequest = {
	sessionId: string;
	capabilityName: string;
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
	readonly sessionHost: RuntimeHost;
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
	const session = await ctx.sessionHost.get(sessionId);
	if (!session) {
		return undefined;
	}
	return toHubSessionRecord(session, ctx.sessionState.get(sessionId));
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
