import type {
	HubCommandEnvelope,
	HubReplyEnvelope,
	ToolApprovalRequest,
} from "@cline/shared";
import { createSessionId } from "@cline/shared";
import { errorReply, type HubTransportContext, okReply } from "./context";

function pendingApprovalPayload(
	approvalId: string,
	request: ToolApprovalRequest,
	createdAt: number,
): Record<string, unknown> {
	return {
		approvalId,
		createdAt,
		sessionId: request.sessionId,
		agentId: request.agentId,
		conversationId: request.conversationId,
		iteration: request.iteration,
		toolCallId: request.toolCallId,
		toolName: request.toolName,
		inputJson: JSON.stringify(request.input ?? null),
		policy: request.policy,
	};
}

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
	return await new Promise((resolve) => {
		const createdAt = Date.now();
		ctx.pendingApprovals.set(approvalId, {
			sessionId,
			request,
			createdAt,
			resolve,
		});
		ctx.publish(
			ctx.buildEvent(
				"approval.requested",
				pendingApprovalPayload(approvalId, request, createdAt),
				sessionId,
			),
		);
	});
}

export function handleApprovalListPending(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): HubReplyEnvelope {
	const sessionId = String(
		envelope.sessionId ?? envelope.payload?.sessionId ?? "",
	).trim();
	if (!sessionId) {
		return errorReply(
			envelope,
			"session_id_required",
			"sessionId is required to list pending approvals",
		);
	}
	const clientId = envelope.clientId?.trim();
	const state = ctx.sessionState.get(sessionId);
	if (
		!clientId ||
		!state ||
		(state.createdByClientId !== clientId && !state.participants.has(clientId))
	) {
		return errorReply(
			envelope,
			"session_not_found",
			"Session was not found or is not attached to this client",
		);
	}
	const approvals = Array.from(ctx.pendingApprovals.entries())
		.filter(([, pending]) => pending.sessionId === sessionId)
		.map(([approvalId, pending]) =>
			pendingApprovalPayload(approvalId, pending.request, pending.createdAt),
		);
	return okReply(envelope, { approvals });
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
