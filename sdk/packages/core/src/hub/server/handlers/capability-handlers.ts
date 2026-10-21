import type { HubCommandEnvelope, HubReplyEnvelope } from "@cline/shared";
import { createSessionId } from "@cline/shared";
import { logHubMessage } from "../hub-server-logging";
import { errorReply, type HubTransportContext, okReply } from "./context";

/**
 * Shown to the user when a run fails because the client that owned one of its
 * capabilities (hooks, client tools) went away mid-request. Client ids stay in
 * the hub log (targetClientId), not in this text.
 */
export const CAPABILITY_OWNER_GONE_MESSAGE =
	"The app running this task disconnected before it could respond. Send a message to continue.";

export function recordCapabilityClients(
	ctx: HubTransportContext,
	sessionId: string,
	clientId: string,
	contributions: readonly { capabilityName: string }[],
): void {
	if (!ctx.capabilityClientsBySession || contributions.length === 0) return;
	// ponytail: entries live as long as the hub process; prune on session delete if it grows.
	let byCapability = ctx.capabilityClientsBySession.get(sessionId);
	if (!byCapability) {
		byCapability = new Map();
		ctx.capabilityClientsBySession.set(sessionId, byCapability);
	}
	for (const { capabilityName } of contributions) {
		const clients = byCapability.get(capabilityName) ?? [];
		if (!clients.includes(clientId)) clients.push(clientId);
		byCapability.set(capabilityName, clients);
	}
}

/**
 * The requested owner if connected, else another client that registered the
 * capability and is still connected and attached to the session (a client
 * that detached no longer receives the session's requests).
 */
function resolveCapabilityOwner(
	ctx: HubTransportContext,
	sessionId: string,
	capabilityName: string,
	targetClientId: string,
): string | undefined {
	if (ctx.clients.has(targetClientId)) return targetClientId;
	const participants = ctx.sessionState.get(sessionId)?.participants;
	return ctx.capabilityClientsBySession
		?.get(sessionId)
		?.get(capabilityName)
		?.find(
			(clientId) => ctx.clients.has(clientId) && participants?.has(clientId),
		);
}

export async function requestCapability(
	ctx: HubTransportContext,
	sessionId: string,
	capabilityName: string,
	payload: Record<string, unknown>,
	requestedClientId: string,
	onProgress?: (payload: Record<string, unknown>) => void,
): Promise<Record<string, unknown> | undefined> {
	const targetClientId =
		resolveCapabilityOwner(ctx, sessionId, capabilityName, requestedClientId) ??
		requestedClientId;
	const requestId = createSessionId("capreq_");
	const startedAt = performance.now();
	logHubMessage("info", "capability.request.start", {
		requestId,
		sessionId,
		capabilityName,
		targetClientId,
	});
	// Unregistering cancels the owner's pending requests, but a request raised
	// after that (a run still in flight when its client restarted) would wait
	// forever: nobody can answer it and nothing times it out.
	if (!ctx.clients.has(targetClientId)) {
		logHubMessage("warn", "capability.request.end", {
			requestId,
			sessionId,
			capabilityName,
			targetClientId,
			ok: false,
			error: "target_client_not_connected",
			durationMs: 0,
		});
		throw new Error(CAPABILITY_OWNER_GONE_MESSAGE);
	}
	return await new Promise((resolve, reject) => {
		ctx.pendingCapabilityRequests.set(requestId, {
			sessionId,
			targetClientId,
			capabilityName,
			onProgress,
			resolve: (result) => {
				logHubMessage(result.ok ? "info" : "warn", "capability.request.end", {
					requestId,
					sessionId,
					capabilityName,
					targetClientId,
					ok: result.ok,
					error: result.error,
					durationMs: Math.round(performance.now() - startedAt),
				});
				if (!result.ok) {
					reject(
						new Error(
							result.error ||
								`Capability ${capabilityName} was rejected by ${targetClientId}.`,
						),
					);
					return;
				}
				resolve(result.payload);
			},
		});
		ctx.publish(
			ctx.buildEvent(
				"capability.requested",
				{
					requestId,
					targetClientId,
					capabilityName,
					payload,
				},
				sessionId,
			),
		);
		logHubMessage("info", "capability.request.published", {
			requestId,
			sessionId,
			capabilityName,
			targetClientId,
		});
	});
}

export function handleCapabilityProgress(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): HubReplyEnvelope {
	const requestId =
		typeof envelope.payload?.requestId === "string"
			? envelope.payload.requestId.trim()
			: "";
	const pending = ctx.pendingCapabilityRequests.get(requestId);
	if (!pending) {
		// Duplicate/late progress after resolve is common with multiple connectors;
		// ack quietly instead of capability_not_found spam.
		return okReply(envelope, { requestId, ignored: true });
	}
	const responderClientId = envelope.clientId?.trim() || "";
	if (responderClientId !== pending.targetClientId) {
		return errorReply(
			envelope,
			"capability_wrong_client",
			`Capability request ${requestId} is owned by ${pending.targetClientId}`,
		);
	}
	if (
		envelope.sessionId?.trim() &&
		envelope.sessionId.trim() !== pending.sessionId
	) {
		return errorReply(
			envelope,
			"capability_wrong_session",
			`Capability request ${requestId} belongs to session ${pending.sessionId}`,
		);
	}
	const payload =
		envelope.payload?.payload &&
		typeof envelope.payload.payload === "object" &&
		!Array.isArray(envelope.payload.payload)
			? (envelope.payload.payload as Record<string, unknown>)
			: {};
	pending.onProgress?.(payload);
	return okReply(envelope, { requestId });
}

export function cancelPendingCapabilityRequests(
	ctx: HubTransportContext,
	filter: (request: {
		requestId: string;
		sessionId: string;
		targetClientId: string;
		capabilityName: string;
	}) => boolean,
	reason: string,
): number {
	let cancelled = 0;
	for (const [requestId, pending] of [
		...ctx.pendingCapabilityRequests.entries(),
	]) {
		if (!filter({ requestId, ...pending })) {
			continue;
		}
		ctx.pendingCapabilityRequests.delete(requestId);
		logHubMessage("warn", "capability.request.cancelled", {
			requestId,
			sessionId: pending.sessionId,
			capabilityName: pending.capabilityName,
			targetClientId: pending.targetClientId,
			reason,
		});
		pending.resolve({ ok: false, error: reason });
		ctx.publish(
			ctx.buildEvent(
				"capability.resolved",
				{
					requestId,
					capabilityName: pending.capabilityName,
					targetClientId: pending.targetClientId,
					ok: false,
					cancelled: true,
					error: reason,
				},
				pending.sessionId,
			),
		);
		cancelled += 1;
	}
	return cancelled;
}

export async function handleCapabilityRequest(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const sessionId =
		typeof envelope.payload?.sessionId === "string"
			? envelope.payload.sessionId.trim()
			: envelope.sessionId?.trim() || "";
	const capabilityName =
		typeof envelope.payload?.capabilityName === "string"
			? envelope.payload.capabilityName.trim()
			: "";
	const targetClientId =
		typeof envelope.payload?.targetClientId === "string"
			? envelope.payload.targetClientId.trim()
			: "";
	if (!sessionId || !capabilityName || !targetClientId) {
		return errorReply(
			envelope,
			"invalid_capability_request",
			"capability.request requires sessionId, capabilityName, and targetClientId",
		);
	}
	try {
		const payload =
			envelope.payload?.payload &&
			typeof envelope.payload.payload === "object" &&
			!Array.isArray(envelope.payload.payload)
				? (envelope.payload.payload as Record<string, unknown>)
				: {};
		const response = await ctx.requestCapability(
			sessionId,
			capabilityName,
			payload,
			targetClientId,
		);
		return okReply(envelope, response);
	} catch (error) {
		return errorReply(
			envelope,
			"capability_request_failed",
			error instanceof Error ? error.message : String(error),
		);
	}
}

export function handleCapabilityRespond(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): HubReplyEnvelope {
	const requestId =
		typeof envelope.payload?.requestId === "string"
			? envelope.payload.requestId.trim()
			: "";
	const pending = ctx.pendingCapabilityRequests.get(requestId);
	if (!pending) {
		// A second connector (or a retried client) often answers after the first
		// already resolved the request. Treat as a no-op success.
		return okReply(envelope, { requestId, ignored: true });
	}
	const responderClientId = envelope.clientId?.trim() || "";
	if (responderClientId !== pending.targetClientId) {
		return errorReply(
			envelope,
			"capability_wrong_client",
			`Capability request ${requestId} is owned by ${pending.targetClientId}`,
		);
	}
	if (
		envelope.sessionId?.trim() &&
		envelope.sessionId.trim() !== pending.sessionId
	) {
		return errorReply(
			envelope,
			"capability_wrong_session",
			`Capability request ${requestId} belongs to session ${pending.sessionId}`,
		);
	}
	ctx.pendingCapabilityRequests.delete(requestId);
	const payload =
		envelope.payload?.payload &&
		typeof envelope.payload.payload === "object" &&
		!Array.isArray(envelope.payload.payload)
			? (envelope.payload.payload as Record<string, unknown>)
			: undefined;
	const error =
		typeof envelope.payload?.error === "string"
			? envelope.payload.error
			: undefined;
	const ok = envelope.payload?.ok === true;
	logHubMessage(ok ? "info" : "warn", "capability.respond", {
		requestId,
		sessionId: pending.sessionId,
		capabilityName: pending.capabilityName,
		targetClientId: pending.targetClientId,
		respondedByClientId: responderClientId,
		ok,
		error,
	});
	pending.resolve({ ok, payload, error });
	ctx.publish(
		ctx.buildEvent(
			"capability.resolved",
			{
				requestId,
				capabilityName: pending.capabilityName,
				targetClientId: pending.targetClientId,
				respondedByClientId: responderClientId,
				ok,
				payload,
				error,
			},
			pending.sessionId,
		),
	);
	return okReply(envelope, { requestId, ok });
}
