import type {
	HubCommandEnvelope,
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
	return await new Promise((resolve) => {
		ctx.pendingApprovals.set(approvalId, {
			sessionId,
			resolve,
		});
		ctx.publish(
			ctx.buildEvent(
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
				},
				sessionId,
			),
		);
	});
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
