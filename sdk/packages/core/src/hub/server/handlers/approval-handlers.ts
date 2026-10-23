import type {
	HubCommandEnvelope,
	HubEventEnvelope,
	HubReplyEnvelope,
	PendingApprovalInfo,
	ToolApprovalRequest,
} from "@cline/shared";
import {
	createSessionId,
	DEFAULT_HUB_APPROVAL_TIMEOUT_MS,
	HUB_APPROVAL_ALREADY_RESOLVED_ERROR_CODE,
	HUB_APPROVAL_TIMEOUT_REASON,
	HUB_NOT_AUTHORIZED_ERROR_CODE,
} from "@cline/shared";
import type { HubConnectionAuthority } from "../command-transport";
import {
	canClientObserveEvent,
	errorReply,
	extractClientId,
	extractSessionId,
	type HubTransportContext,
	isClientRelatedToSession,
	okReply,
	type PendingApproval,
} from "./context";

const APPROVAL_TOOL_TIERS = new Map<string, "read" | "write" | "execute">([
	["read_files", "read"],
	["read_file", "read"],
	["search_codebase", "read"],
	["search_files", "read"],
	["list_code_definition_names", "read"],
	["editor", "write"],
	["apply_patch", "write"],
	["apply_diff", "write"],
	["replace_in_file", "write"],
	["write_to_file", "write"],
]);

function approvalTier(toolName: string): "read" | "write" | "execute" {
	const normalized = toolName.trim().toLowerCase();
	// Namespaced and unknown tools fail closed as executable code.
	if (/__|[:./]/.test(normalized)) return "execute";
	return APPROVAL_TOOL_TIERS.get(normalized) ?? "execute";
}

/**
 * Wire projection of a pending approval. Both `approval.requested` and
 * `approval.list_pending` publish this exact shape so a client can hydrate from
 * either the live event or the recovery command.
 */
export function toPendingApprovalInfo(
	pending: PendingApproval,
): PendingApprovalInfo {
	return {
		approvalId: pending.approvalId,
		sessionId: pending.sessionId,
		agentId: pending.agentId,
		conversationId: pending.conversationId,
		iteration: pending.iteration,
		toolCallId: pending.toolCallId,
		toolName: pending.toolName,
		inputJson: JSON.stringify(pending.input ?? null),
		policy: pending.policy,
		...(pending.agendaTaskId ? { agendaTaskId: pending.agendaTaskId } : {}),
		createdAt: pending.createdAt,
		expiresAt: pending.expiresAt,
	};
}

function resolveApprovalTimeoutMs(ctx: HubTransportContext): number {
	const configured = ctx.approvalTimeoutMs;
	return typeof configured === "number" &&
		Number.isFinite(configured) &&
		configured > 0
		? configured
		: DEFAULT_HUB_APPROVAL_TIMEOUT_MS;
}

function clearExpiryTimer(pending: PendingApproval): void {
	if (pending.expiryTimer === undefined) {
		return;
	}
	clearTimeout(pending.expiryTimer);
	pending.expiryTimer = undefined;
}

/**
 * Auto-deny an approval nobody answered in time. Guarded by the map lookup, so
 * the deny, the `approval.resolved` broadcast and the removal happen exactly
 * once no matter how the expiry is triggered (timer or list sweep).
 */
function expirePendingApproval(
	ctx: HubTransportContext,
	approvalId: string,
): void {
	const pending = ctx.pendingApprovals.get(approvalId);
	if (!pending) {
		return;
	}
	clearExpiryTimer(pending);
	ctx.pendingApprovals.delete(approvalId);
	pending.resolve({ approved: false, reason: HUB_APPROVAL_TIMEOUT_REASON });
	ctx.publish(
		ctx.buildEvent(
			"approval.resolved",
			{
				approvalId,
				approved: false,
				expired: true,
				reason: HUB_APPROVAL_TIMEOUT_REASON,
			},
			pending.sessionId,
		),
	);
}

/**
 * Expire anything already past its deadline *that `clientId` is allowed to act
 * on*. The timer normally gets there first; this keeps `list_pending` and
 * `respond` correct even when timers are starved (a suspended mobile host, a
 * debugger pause, faked clocks).
 *
 * The authorization filter is not cosmetic: expiry auto-denies the approval and
 * publishes `approval.resolved`, so an unscoped sweep let any client's routine
 * `list_pending` poll deny — and announce the denial of — approvals belonging to
 * sessions it has no relationship to.
 */
function sweepExpiredApprovals(
	ctx: HubTransportContext,
	clientId: string,
): void {
	const now = Date.now();
	for (const [approvalId, pending] of [...ctx.pendingApprovals.entries()]) {
		if (
			pending.expiresAt <= now &&
			isClientRelatedToSession(ctx, pending.sessionId, clientId)
		) {
			expirePendingApproval(ctx, approvalId);
		}
	}
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
	const timeoutMs = resolveApprovalTimeoutMs(ctx);
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
		const createdAt = Date.now();
		const pending: PendingApproval = {
			approvalId,
			sessionId,
			agentId: request.agentId,
			conversationId: request.conversationId,
			iteration: request.iteration,
			toolCallId: request.toolCallId,
			toolName: request.toolName,
			input: request.input,
			policy: request.policy,
			...(agendaTaskId ? { agendaTaskId } : {}),
			createdAt,
			expiresAt: createdAt + timeoutMs,
			resolve,
		};
		const requestedEvent = ctx.buildEvent(
			"approval.requested",
			{ ...toPendingApprovalInfo(pending) },
			sessionId,
		);
		pending.requestedEvent = requestedEvent;
		ctx.pendingApprovals.set(approvalId, pending);
		const timer = setTimeout(
			() => expirePendingApproval(ctx, approvalId),
			timeoutMs,
		);
		// Never let a parked approval hold the process open on its own.
		(timer as unknown as { unref?: () => void }).unref?.();
		pending.expiryTimer = timer;
		ctx.publish(requestedEvent);
	});
}

/**
 * Lists approvals the hub is still waiting on, oldest first.
 *
 * Pending approvals live only in `ctx.pendingApprovals`, so a restarted hub
 * reports an empty list (never an error) — clients must treat "not listed" as
 * "no longer actionable" rather than as a transient failure.
 *
 * The reply is scoped to sessions the calling client created or attached to (see
 * `isClientRelatedToSession`), so omitting `sessionId` lists that client's own
 * pending approvals rather than the whole hub's. An unrelated caller gets an
 * empty list rather than an error: "not listed" already means "not actionable",
 * and probing must not reveal that other sessions have approvals pending.
 * Expired entries are swept first and never appear.
 */
export function handleApprovalListPending(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): HubReplyEnvelope {
	const sessionId = extractSessionId(envelope);
	const clientId = extractClientId(envelope);
	sweepExpiredApprovals(ctx, clientId);
	const approvals = [...ctx.pendingApprovals.values()]
		.filter((pending) => !sessionId || pending.sessionId === sessionId)
		.filter((pending) =>
			isClientRelatedToSession(ctx, pending.sessionId, clientId),
		)
		.sort((left, right) => left.createdAt - right.createdAt)
		.map(toPendingApprovalInfo);
	return okReply(envelope, { approvals });
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
	clientId?: string,
): HubEventEnvelope[] {
	const events: HubEventEnvelope[] = [];
	for (const pending of ctx.pendingApprovals.values()) {
		if (!pending.requestedEvent) {
			continue;
		}
		if (sessionId && pending.sessionId !== sessionId) {
			continue;
		}
		if (
			clientId &&
			!canClientObserveEvent(ctx, clientId, pending.requestedEvent)
		) {
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
	clearExpiryTimer(pending);
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
		clearExpiryTimer(pending);
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

/**
 * Structured reply for a respond call that has nothing left to resolve: the
 * approval was answered by another client, cancelled by an abort/shutdown, lost
 * to a hub restart, or never existed. Callers cannot distinguish those cases and
 * should not have to — in all of them the approval is no longer actionable, and
 * `approval.resolved` has already fired (exactly once) for whoever won.
 */
function alreadyResolvedReply(
	envelope: HubCommandEnvelope,
	approvalId: string,
): HubReplyEnvelope {
	return errorReply(
		envelope,
		HUB_APPROVAL_ALREADY_RESOLVED_ERROR_CODE,
		`Approval ${approvalId} is no longer pending; it was already resolved or never existed.`,
		{ approvalId },
	);
}

export async function handleApprovalRespond(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
	authority?: HubConnectionAuthority,
): Promise<HubReplyEnvelope> {
	sweepExpiredApprovals(ctx, extractClientId(envelope));
	const approvalId =
		typeof envelope.payload?.approvalId === "string"
			? envelope.payload.approvalId.trim()
			: "";
	const pending = ctx.pendingApprovals.get(approvalId);
	// Existence is checked before authorization because the session an approval
	// belongs to is only known from the record itself. An unknown id therefore
	// reports `already_resolved` (the same answer every client gets for an
	// approval that is no longer actionable) rather than `not_authorized`.
	if (!pending) {
		return alreadyResolvedReply(envelope, approvalId);
	}
	const clientId = extractClientId(envelope);
	if (!isClientRelatedToSession(ctx, pending.sessionId, clientId)) {
		return errorReply(
			envelope,
			HUB_NOT_AUTHORIZED_ERROR_CODE,
			`Client ${clientId || "(anonymous)"} is not a participant of session ${pending.sessionId} and cannot answer approval ${approvalId}.`,
			{ approvalId, sessionId: pending.sessionId },
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
	const devicePolicy = authority?.pairedDevice?.approvalPolicy;
	if (
		approved &&
		reason === "auto-approved" &&
		devicePolicy &&
		devicePolicy[approvalTier(pending.toolName)] !== "auto"
	) {
		return errorReply(
			envelope,
			"auto_approval_not_allowed",
			`This computer requires confirmation before ${pending.toolName} can run.`,
			{ approvalId, sessionId: pending.sessionId },
		);
	}
	const resolved = resolvePendingApproval(ctx, approvalId, {
		approved,
		reason,
	});
	if (!resolved) {
		// Lost a race with another responder (or with run.abort) between the
		// presence check above and the delete inside resolvePendingApproval.
		return alreadyResolvedReply(envelope, approvalId);
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
