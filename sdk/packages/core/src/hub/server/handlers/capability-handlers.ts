import type { HubCommandEnvelope, HubReplyEnvelope } from "@cline/shared";
import {
	createSessionId,
	HUB_TOOL_EXECUTOR_CAPABILITY_PREFIX,
} from "@cline/shared";
import { logHubMessage } from "../hub-server-logging";
import {
	errorReply,
	type HubTransportContext,
	okReply,
	type PendingCapabilityRequest,
} from "./context";

export const CAPABILITY_RECONNECT_GRACE_MS = 30_000;

export function isReconnectableCapability(capabilityName: string): boolean {
	return capabilityName === `${HUB_TOOL_EXECUTOR_CAPABILITY_PREFIX}askQuestion`;
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
	return await new Promise((resolve, reject) => {
		const pending: PendingCapabilityRequest = {
			sessionId,
			targetClientId,
			capabilityName,
			payload,
			onProgress,
			resolve: (result) => {
				logHubMessage(result.ok ? "info" : "warn", "capability.request.end", {
					requestId,
					sessionId,
					capabilityName,
					targetClientId: pending.targetClientId,
					ok: result.ok,
					error: result.error,
					durationMs: Math.round(performance.now() - startedAt),
				});
				if (!result.ok) {
					reject(
						new Error(
							result.error ||
								`Capability ${capabilityName} was rejected by ${pending.targetClientId}.`,
						),
					);
					return;
				}
				resolve(result.payload);
			},
		};
		ctx.pendingCapabilityRequests.set(requestId, pending);
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
		if (
			!ctx.clients.has(targetClientId) &&
			isReconnectableCapability(capabilityName)
		) {
			retainPendingCapabilityRequestsForReconnect(
				ctx,
				(request) => request.requestId === requestId,
				CAPABILITY_RECONNECT_GRACE_MS,
				`Capability owner client ${targetClientId} did not reconnect before the grace period expired.`,
			);
		}
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
		if (pending.disconnectTimer) clearTimeout(pending.disconnectTimer);
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

export function retainPendingCapabilityRequestsForReconnect(
	ctx: HubTransportContext,
	filter: (request: {
		requestId: string;
		sessionId: string;
		targetClientId: string;
		capabilityName: string;
	}) => boolean,
	timeoutMs: number,
	reason: string,
): number {
	let retained = 0;
	for (const [requestId, pending] of ctx.pendingCapabilityRequests.entries()) {
		if (!filter({ requestId, ...pending }) || pending.disconnectTimer) continue;
		const requestReason = `${reason} (session ${pending.sessionId})`;
		pending.disconnectTimer = setTimeout(() => {
			cancelPendingCapabilityRequests(
				ctx,
				(request) => request.requestId === requestId,
				requestReason,
			);
		}, timeoutMs);
		retained += 1;
	}
	return retained;
}

export type ClaimedCapabilityRequest = {
	requestId: string;
	capabilityName: string;
	payload: Record<string, unknown>;
};

/**
 * Rebinds matching pending requests to the claiming client. Returns every
 * matched request (replayed or not) so the claim reply can carry them; the
 * reply is the reliable channel for claimers whose subscription may not have
 * been live when the replay event was published.
 */
export function claimPendingCapabilityRequests(
	ctx: HubTransportContext,
	sessionId: string,
	capabilityNames: ReadonlySet<string>,
	targetClientId: string,
): ClaimedCapabilityRequest[] {
	const claimed: ClaimedCapabilityRequest[] = [];
	for (const [requestId, pending] of ctx.pendingCapabilityRequests.entries()) {
		if (
			pending.sessionId !== sessionId ||
			!capabilityNames.has(pending.capabilityName)
		) {
			continue;
		}
		const shouldReplay =
			pending.targetClientId !== targetClientId || !!pending.disconnectTimer;
		if (pending.disconnectTimer) {
			clearTimeout(pending.disconnectTimer);
			pending.disconnectTimer = undefined;
		}
		pending.targetClientId = targetClientId;
		claimed.push({
			requestId,
			capabilityName: pending.capabilityName,
			payload: pending.payload ?? {},
		});
		if (!shouldReplay) continue;
		ctx.publish(
			ctx.buildEvent(
				"capability.requested",
				{
					requestId,
					targetClientId,
					capabilityName: pending.capabilityName,
					payload: pending.payload ?? {},
				},
				sessionId,
			),
		);
	}
	return claimed;
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
	if (pending.disconnectTimer) clearTimeout(pending.disconnectTimer);
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
