import type {
	HubCommandEnvelope,
	HubEventEnvelope,
	HubReplyEnvelope,
	ToolApprovalRequest,
} from "@cline/shared";
import { createSessionId } from "@cline/shared";
import { errorReply, type HubTransportContext, okReply } from "./context";

export async function requestToolApproval(
	ctx: HubTransportContext,
	request: ToolApprovalRequest,
): Promise<{ approved: boolean; reason?: string }> {
	const approvalId = createSessionId("approval_");
	const sessionId = request.sessionId;
	const state = ctx.sessionState.get(sessionId);
	if (state?.interactive === false) {
		return {
			approved: false,
			reason:
				"Tool approval requires an interactive session, but this session is non-interactive.",
		};
	}
	let session:
		| Awaited<ReturnType<typeof ctx.sessionHost.getSession>>
		| undefined;
	try {
		session = await ctx.sessionHost.getSession(sessionId);
	} catch {
		session = undefined;
	}
	const agendaTaskId =
		typeof session?.metadata?.agendaTaskId === "string"
			? session.metadata.agendaTaskId
			: undefined;
	return await new Promise((resolve) => {
		const requestedEvent = ctx.buildEvent(
			"approval.requested",
			{
				approvalId,
				sessionId: request.sessionId,
				agentId: request.agentId,
				conversationId: request.conversationId,
				iteration: request.iteration,
				toolCallId: request.toolCallId,
				toolName: request.toolName,
				inputJson: JSON.stringify(request.input ?? null),
				policy: request.policy,
				agendaTaskId,
			},
			sessionId,
		);
		ctx.pendingApprovals.set(approvalId, {
			sessionId,
			resolve,
			requestedEvent,
		});
		ctx.publish(requestedEvent);
	});
}

/**
 * Pending `approval.requested` events, optionally scoped to one session.
 * Re-issued to a (re)subscribing client so an approval raised while nobody
 * was connected — or while this client was disconnected — is neither lost
 * nor implicitly answered.
 */
export function pendingApprovalEvents(
	ctx: HubTransportContext,
	sessionId?: string,
): HubEventEnvelope[] {
	const events: HubEventEnvelope[] = [];
	for (const pending of ctx.pendingApprovals.values()) {
		if (!pending.requestedEvent) {
			continue;
		}
		if (sessionId && pending.sessionId !== sessionId) {
			continue;
		}
		events.push(pending.requestedEvent);
	}
	return events;
}

export function resolvePendingApproval(
	ctx: HubTransportContext,
	approvalId: string,
	result: { approved: boolean; reason?: string },
): { sessionId: string } | undefined {
	const pending = ctx.pendingApprovals.get(approvalId);
	if (!pending) {
		return undefined;
	}
	ctx.pendingApprovals.delete(approvalId);
	pending.resolve(result);
	return { sessionId: pending.sessionId };
}

export function cancelPendingApprovals(
	ctx: HubTransportContext,
	filter: (approval: { approvalId: string; sessionId: string }) => boolean,
	reason: string,
): number {
	let cancelled = 0;
	for (const [approvalId, pending] of [...ctx.pendingApprovals.entries()]) {
		if (!filter({ approvalId, sessionId: pending.sessionId })) {
			continue;
		}
		ctx.pendingApprovals.delete(approvalId);
		pending.resolve({ approved: false, reason });
		ctx.publish(
			ctx.buildEvent(
				"approval.resolved",
				{ approvalId, approved: false, cancelled: true, reason },
				pending.sessionId,
			),
		);
		cancelled += 1;
	}
	return cancelled;
}

export async function handleApprovalRespond(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const approvalId =
		typeof envelope.payload?.approvalId === "string"
			? envelope.payload.approvalId.trim()
			: "";
	const pending = ctx.pendingApprovals.get(approvalId);
	if (!pending) {
		return errorReply(
			envelope,
			"approval_not_found",
			`Unknown approval: ${approvalId}`,
		);
	}
	const reason =
		typeof envelope.payload?.reason === "string"
			? envelope.payload.reason
			: envelope.payload?.payload &&
					typeof envelope.payload.payload === "object" &&
					!Array.isArray(envelope.payload.payload) &&
					typeof (envelope.payload.payload as Record<string, unknown>)
						.reason === "string"
				? ((envelope.payload.payload as Record<string, unknown>)
						.reason as string)
				: undefined;
	const approved = envelope.payload?.approved === true;
	const resolved = resolvePendingApproval(ctx, approvalId, {
		approved,
		reason,
	});
	if (!resolved) {
		return errorReply(
			envelope,
			"approval_not_found",
			`Unknown approval: ${approvalId}`,
		);
	}
	ctx.publish(
		ctx.buildEvent(
			"approval.resolved",
			{ approvalId, approved, reason },
			resolved.sessionId,
		),
	);
	return okReply(envelope, { approvalId, approved });
}
