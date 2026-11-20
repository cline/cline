import type {
	HubCommandEnvelope,
	HubEventEnvelope,
	HubReplyEnvelope,
} from "@cline/shared";
import { createSessionId } from "@cline/shared";
import { captureCapabilityOwnerGone } from "../../../services/telemetry/core-events";
import { logHubMessage } from "../hub-server-logging";
import { errorReply, type HubTransportContext, okReply } from "./context";

/**
 * Shown to the user when a run fails because the client that owned one of its
 * capabilities (hooks, client tools) went away mid-request. Client ids stay in
 * the hub log (targetClientId), not in this text.
 */
export const CAPABILITY_OWNER_GONE_MESSAGE =
	"The app running this task disconnected before it could respond. Reopen the task to continue.";

/**
 * How long a request waits for its owner to reconnect under the same client
 * id before failing: a little over the client's 5s reconnect backoff, so a
 * brief socket drop doesn't end the run.
 */
export const CAPABILITY_OWNER_RECONNECT_GRACE_MS = 7_000;

/**
 * Requests that waited for their owner to reconnect, to deliver to that owner
 * now that it is subscribed again. Each is returned once.
 */
export function takeUndeliveredCapabilityEvents(
	ctx: HubTransportContext,
	clientId: string,
	sessionId?: string,
): HubEventEnvelope[] {
	const events: HubEventEnvelope[] = [];
	for (const pending of ctx.pendingCapabilityRequests.values()) {
		if (
			!pending.undeliveredEvent ||
			pending.targetClientId !== clientId ||
			(sessionId && pending.sessionId !== sessionId)
		) {
			continue;
		}
		events.push(pending.undeliveredEvent);
		pending.undeliveredEvent = undefined;
	}
	return events;
}

export async function requestCapability(
	ctx: HubTransportContext,
	sessionId: string,
	capabilityName: string,
	payload: Record<string, unknown>,
	targetClientId: string,
	onProgress?: (payload: Record<string, unknown>) => void,
): Promise<Record<string, unknown> | undefined> {
	const requestId = createSessionId("capreq_");
	const startedAt = performance.now();
	logHubMessage("info", "capability.request.start", {
		requestId,
		sessionId,
		capabilityName,
		targetClientId,
	});
	const fail = (reason: "detached" | "disconnected") => {
		logHubMessage("warn", "capability.request.end", {
			requestId,
			sessionId,
			capabilityName,
			targetClientId,
			ok: false,
			error: `target_client_${reason}`,
			durationMs: Math.round(performance.now() - startedAt),
		});
		captureCapabilityOwnerGone(ctx.telemetry, {
			sessionId,
			capabilityName,
			reason,
		});
		return new Error(CAPABILITY_OWNER_GONE_MESSAGE);
	};
	// Unregistering or detaching cancels the owner's pending requests, but a
	// request raised after that (a run still in flight when its client
	// restarted) would wait forever: nobody answers it and nothing times it
	// out. Requests are never handed to another client: a client that joined
	// later may enforce different hooks or tools under the same name.
	if (ctx.detachedClientsBySession?.get(sessionId)?.has(targetClientId)) {
		throw fail("detached");
	}
	return await new Promise((resolve, reject) => {
		const event = ctx.buildEvent(
			"capability.requested",
			{
				requestId,
				targetClientId,
				capabilityName,
				payload,
			},
			sessionId,
		);
		const connected = ctx.clients.has(targetClientId);
		// Registered before any waiting, so Stop (or a detach) cancels it
		// whether it is waiting for the owner to reconnect or to answer.
		ctx.pendingCapabilityRequests.set(requestId, {
			sessionId,
			targetClientId,
			capabilityName,
			onProgress,
			undeliveredEvent: connected ? undefined : event,
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
					if (result.error === CAPABILITY_OWNER_GONE_MESSAGE) {
						captureCapabilityOwnerGone(ctx.telemetry, {
							sessionId,
							capabilityName,
							reason: "cancelled_while_waiting",
						});
					}
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
		if (!connected) {
			// A disconnected owner gets a short grace period to come back under the
			// same id (a brief socket drop); the request reaches it when it
			// subscribes again (see takeUndeliveredCapabilityEvents).
			setTimeout(() => {
				const pending = ctx.pendingCapabilityRequests.get(requestId);
				if (!pending?.undeliveredEvent) return;
				ctx.pendingCapabilityRequests.delete(requestId);
				reject(fail("disconnected"));
			}, CAPABILITY_OWNER_RECONNECT_GRACE_MS);
			return;
		}
		ctx.publish(event);
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
