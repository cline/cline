import type { HubEventEnvelope, ToolApprovalRequest } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeHost } from "../../../runtime/host/runtime-host";
import {
	cancelPendingApprovals,
	handleApprovalListPending,
	handleApprovalRespond,
	requestToolApproval,
} from "./approval-handlers";
import {
	buildHubEvent,
	defaultAuthorizeAttach,
	ensureSessionParticipant,
	ensureSessionState,
	type HubTransportContext,
} from "./context";

/**
 * A context per test is also the "fresh hub" fixture: pending approvals live
 * only in these maps, so a new context is exactly the post-restart state.
 */
function createContext(
	options: { approvalTimeoutMs?: number } = {},
): HubTransportContext & { events: HubEventEnvelope[] } {
	const events: HubEventEnvelope[] = [];
	return {
		...(options.approvalTimeoutMs !== undefined
			? { approvalTimeoutMs: options.approvalTimeoutMs }
			: {}),
		clients: new Map(),
		sessionState: new Map(),
		pendingApprovals: new Map(),
		pendingCapabilityRequests: new Map(),
		suppressNextTerminalEventBySession: new Map(),
		sessionTrustModel: "session-scoped" as const,
		attachAllowlist: new Set<string>(),
		authorizeAttach: defaultAuthorizeAttach,
		activeRpcTurnCountBySession: new Map(),
		sessionSearch: { removeSession: vi.fn() } as never,
		sessionHost: {
			subscribe: vi.fn(),
			startSession: vi.fn(),
			runTurn: vi.fn(),
			restoreSession: vi.fn(),
			abort: vi.fn(),
			stopSession: vi.fn(),
			dispose: vi.fn(),
			getSession: vi.fn(),
			listSessions: vi.fn(),
		} as unknown as RuntimeHost,
		publish: (event) => {
			events.push(event);
		},
		buildEvent: buildHubEvent,
		requestCapability: vi.fn(),
		events,
	};
}

/**
 * The common fixture: an interactive session owned by `clientId`. Ownership is
 * part of the fixture because approvals are only answerable by a session's
 * creator or participants — a session with no recorded relationship is denied.
 */
function markInteractive(
	ctx: HubTransportContext,
	sessionId: string,
	clientId = "client-1",
): void {
	ensureSessionState(ctx, sessionId, clientId, "creator", {
		interactive: true,
	});
}

/** An interactive session the hub cannot attribute to anybody. */
function markUnownedInteractive(
	ctx: HubTransportContext,
	sessionId: string,
): void {
	ctx.sessionState.set(sessionId, {
		interactive: true,
		participants: new Map(),
	});
}

function approvalRequest(
	overrides: Partial<ToolApprovalRequest> = {},
): ToolApprovalRequest {
	return {
		sessionId: "session-1",
		agentId: "agent-1",
		conversationId: "conversation-1",
		iteration: 3,
		toolCallId: "call-1",
		toolName: "run_commands",
		input: { commands: ["echo hi"] },
		policy: { autoApprove: false },
		...overrides,
	};
}

/** Starts an approval and returns its id once `approval.requested` is seen. */
async function startApproval(
	ctx: HubTransportContext & { events: HubEventEnvelope[] },
	overrides: Partial<ToolApprovalRequest> = {},
): Promise<{
	approvalId: string;
	result: Promise<{ approved: boolean; reason?: string }>;
}> {
	const before = ctx.events.length;
	const result = requestToolApproval(ctx, approvalRequest(overrides));
	await Promise.resolve();
	const requested = ctx.events
		.slice(before)
		.find((event) => event.event === "approval.requested");
	const approvalId = requested?.payload?.approvalId;
	if (typeof approvalId !== "string") {
		throw new Error("approval.requested was not published");
	}
	return { approvalId, result };
}

function listPending(
	ctx: HubTransportContext,
	payload?: Record<string, unknown>,
	clientId: string | undefined = "client-1",
) {
	return handleApprovalListPending(ctx, {
		version: "v1",
		command: "approval.list_pending",
		requestId: "req-list",
		...(clientId ? { clientId } : {}),
		...(payload ? { payload } : {}),
	});
}

function respond(
	ctx: HubTransportContext,
	payload: Record<string, unknown>,
	requestId = "req-respond",
	clientId: string | undefined = "client-1",
	authority?: Parameters<typeof handleApprovalRespond>[2],
) {
	return handleApprovalRespond(
		ctx,
		{
			version: "v1",
			command: "approval.respond",
			requestId,
			...(clientId ? { clientId } : {}),
			payload,
		},
		authority,
	);
}

it("caps unattended mobile approvals at the computer's device policy", async () => {
	const ctx = createContext();
	markInteractive(ctx, "session-1");
	const { approvalId, result } = await startApproval(ctx, {
		toolName: "run_commands",
	});
	const authority = {
		clientId: "client-1",
		pairedDevice: {
			deviceId: "device-1",
			approvalPolicy: { read: "auto", write: "ask", execute: "ask" } as const,
		},
	};

	await expect(
		respond(
			ctx,
			{ approvalId, approved: true, reason: "auto-approved" },
			"req-auto",
			"client-1",
			authority,
		),
	).resolves.toMatchObject({
		ok: false,
		error: { code: "auto_approval_not_allowed" },
	});
	expect(ctx.pendingApprovals.has(approvalId)).toBe(true);

	await expect(
		respond(
			ctx,
			{ approvalId, approved: true, reason: "approved on phone" },
			"req-manual",
			"client-1",
			authority,
		),
	).resolves.toMatchObject({ ok: true });
	await expect(result).resolves.toEqual({
		approved: true,
		reason: "approved on phone",
	});
});

describe("approval.list_pending", () => {
	it("returns a live pending approval with everything a late joiner needs", async () => {
		const ctx = createContext();
		markInteractive(ctx, "session-1");

		const { approvalId, result } = await startApproval(ctx);

		const reply = await listPending(ctx);
		expect(reply.ok).toBe(true);
		const approvals = reply.payload?.approvals as Array<
			Record<string, unknown>
		>;
		expect(approvals).toHaveLength(1);
		expect(approvals[0]).toEqual({
			approvalId,
			sessionId: "session-1",
			agentId: "agent-1",
			conversationId: "conversation-1",
			iteration: 3,
			toolCallId: "call-1",
			toolName: "run_commands",
			inputJson: JSON.stringify({ commands: ["echo hi"] }),
			policy: { autoApprove: false },
			createdAt: expect.any(Number),
			expiresAt: expect.any(Number),
		});

		// The list reply and the approval.requested event describe the approval
		// identically, so a client can use either source interchangeably.
		const requested = ctx.events.find(
			(event) => event.event === "approval.requested",
		);
		expect(requested?.payload).toEqual(approvals[0]);

		await respond(ctx, { approvalId, approved: true });
		await expect(result).resolves.toEqual({
			approved: true,
			reason: undefined,
		});
	});

	it("filters by sessionId when the payload supplies one", async () => {
		const ctx = createContext();
		markInteractive(ctx, "session-1");
		markInteractive(ctx, "session-2");

		const first = await startApproval(ctx);
		const second = await startApproval(ctx, {
			sessionId: "session-2",
			toolCallId: "call-2",
		});

		const filtered = await listPending(ctx, { sessionId: "session-2" });
		const approvals = filtered.payload?.approvals as Array<
			Record<string, unknown>
		>;
		expect(approvals.map((approval) => approval.approvalId)).toEqual([
			second.approvalId,
		]);

		const all = await listPending(ctx);
		expect(
			(all.payload?.approvals as Array<Record<string, unknown>>).map(
				(approval) => approval.approvalId,
			),
		).toEqual([first.approvalId, second.approvalId]);

		await respond(ctx, { approvalId: first.approvalId, approved: false });
		await respond(ctx, { approvalId: second.approvalId, approved: false });
		await Promise.all([first.result, second.result]);
	});

	it("returns an empty list on a fresh hub (pendings do not survive restart)", async () => {
		const ctx = createContext();

		const reply = await listPending(ctx);

		expect(reply.ok).toBe(true);
		expect(reply.payload).toEqual({ approvals: [] });
	});

	it("never lists approvals for non-interactive sessions", async () => {
		const ctx = createContext();
		ctx.sessionState.set("session-1", {
			interactive: false,
			participants: new Map(),
		});

		await expect(requestToolApproval(ctx, approvalRequest())).resolves.toEqual({
			approved: false,
			reason:
				"Tool approval requires an interactive session, but this session is non-interactive.",
		});

		const reply = await listPending(ctx);
		expect(reply.payload).toEqual({ approvals: [] });
		expect(
			ctx.events.some((event) => event.event === "approval.requested"),
		).toBe(false);
	});
});

describe("approval.respond resolved-elsewhere semantics", () => {
	it("drops the approval from the list and publishes approval.resolved once", async () => {
		const ctx = createContext();
		markInteractive(ctx, "session-1");
		const { approvalId, result } = await startApproval(ctx);

		const reply = await respond(ctx, {
			approvalId,
			approved: true,
			reason: "approved by user",
		});

		expect(reply).toMatchObject({ ok: true });
		await expect(result).resolves.toEqual({
			approved: true,
			reason: "approved by user",
		});
		expect(
			(await listPending(ctx)).payload?.approvals as unknown[],
		).toHaveLength(0);
		expect(
			ctx.events.filter(
				(event) =>
					event.event === "approval.resolved" &&
					event.payload?.approvalId === approvalId,
			),
		).toHaveLength(1);
	});

	it("reports already_resolved when the same approval is answered twice", async () => {
		const ctx = createContext();
		markInteractive(ctx, "session-1");
		const { approvalId, result } = await startApproval(ctx);

		await respond(ctx, { approvalId, approved: true }, "req-first");
		const second = await respond(
			ctx,
			{ approvalId, approved: false },
			"req-second",
		);

		expect(second).toMatchObject({
			ok: false,
			requestId: "req-second",
			error: {
				code: "already_resolved",
				details: { approvalId },
			},
		});
		// The broadcast must stay single-fire even though respond was called twice.
		expect(
			ctx.events.filter((event) => event.event === "approval.resolved"),
		).toHaveLength(1);
		await expect(result).resolves.toEqual({
			approved: true,
			reason: undefined,
		});
	});

	it("reports already_resolved for an approval id the hub never had", async () => {
		const ctx = createContext();

		const reply = await respond(ctx, {
			approvalId: "approval_missing",
			approved: true,
		});

		expect(reply).toMatchObject({
			ok: false,
			error: {
				code: "already_resolved",
				details: { approvalId: "approval_missing" },
			},
		});
		expect(
			ctx.events.some((event) => event.event === "approval.resolved"),
		).toBe(false);
	});
});

describe("approval authorization", () => {
	/**
	 * Two sessions owned by two different clients: the ACL surface the hub had no
	 * notion of before, so `list_pending` returned both and either client could
	 * answer the other's approval.
	 */
	async function twoOwnedSessions() {
		const ctx = createContext();
		ensureSessionState(ctx, "session-1", "client-1", "creator", {
			interactive: true,
		});
		ensureSessionState(ctx, "session-2", "client-2", "creator", {
			interactive: true,
		});
		const first = await startApproval(ctx);
		const second = await startApproval(ctx, {
			sessionId: "session-2",
			toolCallId: "call-2",
		});
		return { ctx, first, second };
	}

	it("lists only approvals for sessions the caller owns or attached to", async () => {
		const { ctx, first, second } = await twoOwnedSessions();

		const forOwner = await listPending(ctx, undefined, "client-1");
		expect(
			(forOwner.payload?.approvals as Array<Record<string, unknown>>).map(
				(approval) => approval.approvalId,
			),
		).toEqual([first.approvalId]);

		const forOther = await listPending(ctx, undefined, "client-2");
		expect(
			(forOther.payload?.approvals as Array<Record<string, unknown>>).map(
				(approval) => approval.approvalId,
			),
		).toEqual([second.approvalId]);

		// Explicitly naming somebody else's session does not widen the scope.
		const spoofed = await listPending(
			ctx,
			{ sessionId: "session-2" },
			"client-1",
		);
		expect(spoofed.payload?.approvals).toEqual([]);

		// An unknown client sees nothing at all.
		const stranger = await listPending(ctx, undefined, "client-9");
		expect(stranger.payload?.approvals).toEqual([]);

		await respond(
			ctx,
			{ approvalId: first.approvalId, approved: false },
			"r1",
			"client-1",
		);
		await respond(
			ctx,
			{ approvalId: second.approvalId, approved: false },
			"r2",
			"client-2",
		);
		await Promise.all([first.result, second.result]);
	});

	it("rejects approval.respond from a client with no relationship to the session", async () => {
		const { ctx, first, second } = await twoOwnedSessions();

		const reply = await respond(
			ctx,
			{ approvalId: first.approvalId, approved: true },
			"req-cross",
			"client-2",
		);
		expect(reply).toMatchObject({
			ok: false,
			error: {
				code: "not_authorized",
				details: { approvalId: first.approvalId, sessionId: "session-1" },
			},
		});
		// The approval is untouched: still pending, no resolved broadcast.
		expect(ctx.pendingApprovals.has(first.approvalId)).toBe(true);
		expect(
			ctx.events.some((event) => event.event === "approval.resolved"),
		).toBe(false);

		const owned = await respond(
			ctx,
			{ approvalId: first.approvalId, approved: true },
			"req-owner",
			"client-1",
		);
		expect(owned).toMatchObject({ ok: true });
		await expect(first.result).resolves.toMatchObject({ approved: true });

		await respond(
			ctx,
			{ approvalId: second.approvalId, approved: false },
			"r2",
			"client-2",
		);
		await second.result;
	});

	it("authorizes a client that attached to the session", async () => {
		const ctx = createContext();
		ensureSessionState(ctx, "session-1", "client-1", "creator", {
			interactive: true,
		});
		const { approvalId, result } = await startApproval(ctx);

		// Pre-attach: invisible and unanswerable.
		expect(
			(await listPending(ctx, undefined, "mobile-1")).payload?.approvals,
		).toEqual([]);

		ensureSessionParticipant(ctx, "session-1", "mobile-1", "participant");

		const listed = await listPending(ctx, undefined, "mobile-1");
		expect(
			(listed.payload?.approvals as Array<Record<string, unknown>>).map(
				(approval) => approval.approvalId,
			),
		).toEqual([approvalId]);
		await expect(
			respond(ctx, { approvalId, approved: true }, "req-attached", "mobile-1"),
		).resolves.toMatchObject({ ok: true });
		await expect(result).resolves.toMatchObject({ approved: true });
	});

	it("denies every caller when the session tracks no client relationships", async () => {
		// There is no open fallback: an unattributable session is not an invitation.
		// Waiting for the last participant to disconnect (which drops the session's
		// state) used to be enough to answer somebody else's approvals.
		const ctx = createContext();
		markUnownedInteractive(ctx, "session-1");
		const { approvalId, result } = await startApproval(ctx);

		expect(
			(await listPending(ctx, undefined, "whoever")).payload?.approvals,
		).toEqual([]);
		await expect(
			respond(ctx, { approvalId, approved: true }, "req-unowned", "whoever"),
		).resolves.toMatchObject({
			ok: false,
			error: {
				code: "not_authorized",
				details: { approvalId, sessionId: "session-1" },
			},
		});
		// Also denied when the hub has no state for the session at all.
		ctx.sessionState.delete("session-1");
		await expect(
			respond(ctx, { approvalId, approved: true }, "req-stateless", "whoever"),
		).resolves.toMatchObject({
			ok: false,
			error: { code: "not_authorized" },
		});
		expect(ctx.pendingApprovals.has(approvalId)).toBe(true);

		cancelPendingApprovals(ctx, () => true, "test cleanup");
		await expect(result).resolves.toMatchObject({ approved: false });
	});

	it("denies an anonymous caller even when the session is tracked", async () => {
		const ctx = createContext();
		markInteractive(ctx, "session-1");
		const { approvalId, result } = await startApproval(ctx);

		expect((await listPending(ctx, undefined, "")).payload?.approvals).toEqual(
			[],
		);
		await expect(
			respond(ctx, { approvalId, approved: true }, "req-anon", ""),
		).resolves.toMatchObject({
			ok: false,
			error: { code: "not_authorized" },
		});

		await respond(ctx, { approvalId, approved: false }, "req-owner");
		await expect(result).resolves.toMatchObject({ approved: false });
	});

	it("re-authorizes a client that attaches after the session's state was dropped", async () => {
		// The disconnect path (`detachClientFromSessions`) deletes the whole session
		// state once the last participant leaves. A client that attaches afterwards
		// must be able to rebuild the relationship from nothing; one that does not
		// attach stays denied.
		const ctx = createContext();
		markInteractive(ctx, "session-1");
		const { approvalId, result } = await startApproval(ctx);
		ctx.sessionState.delete("session-1");

		expect(
			(await listPending(ctx, undefined, "mobile-1")).payload?.approvals,
		).toEqual([]);

		ensureSessionParticipant(ctx, "session-1", "mobile-1", "participant");

		expect(
			(
				(await listPending(ctx, undefined, "mobile-1")).payload
					?.approvals as Array<Record<string, unknown>>
			).map((approval) => approval.approvalId),
		).toEqual([approvalId]);
		// A client that never attached is still denied on the same session.
		await expect(
			respond(ctx, { approvalId, approved: true }, "req-lurker", "lurker-1"),
		).resolves.toMatchObject({
			ok: false,
			error: { code: "not_authorized" },
		});
		await expect(
			respond(ctx, { approvalId, approved: true }, "req-attached", "mobile-1"),
		).resolves.toMatchObject({ ok: true });
		await expect(result).resolves.toMatchObject({ approved: true });
	});
});

describe("approval expiry", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("auto-denies once, broadcasts resolved and forgets the approval", async () => {
		vi.useFakeTimers();
		const ctx = createContext({ approvalTimeoutMs: 1_000 });
		ensureSessionState(ctx, "session-1", "client-1", "creator", {
			interactive: true,
		});
		const { approvalId, result } = await startApproval(ctx);
		const listedBefore = await listPending(ctx, undefined, "client-1");
		expect(listedBefore.payload?.approvals).toHaveLength(1);
		expect(
			(listedBefore.payload?.approvals as Array<Record<string, unknown>>)[0]
				?.expiresAt,
		).toBe(Date.now() + 1_000);

		await vi.advanceTimersByTimeAsync(1_001);

		await expect(result).resolves.toEqual({
			approved: false,
			reason: "approval_timeout",
		});
		const resolved = ctx.events.filter(
			(event) => event.event === "approval.resolved",
		);
		expect(resolved).toHaveLength(1);
		expect(resolved[0]).toMatchObject({
			sessionId: "session-1",
			payload: { approvalId, approved: false, reason: "approval_timeout" },
		});
		expect(ctx.pendingApprovals.has(approvalId)).toBe(false);
		expect(
			(await listPending(ctx, undefined, "client-1")).payload?.approvals,
		).toEqual([]);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("never lists an entry whose deadline has passed", async () => {
		vi.useFakeTimers();
		const ctx = createContext({ approvalTimeoutMs: 1_000 });
		ensureSessionState(ctx, "session-1", "client-1", "creator", {
			interactive: true,
		});
		const { approvalId, result } = await startApproval(ctx);

		// Move the clock past the deadline without letting the timer callback run.
		vi.setSystemTime(Date.now() + 5_000);
		const listed = await listPending(ctx, undefined, "client-1");
		expect(listed.payload?.approvals).toEqual([]);
		expect(ctx.pendingApprovals.has(approvalId)).toBe(false);
		await expect(result).resolves.toEqual({
			approved: false,
			reason: "approval_timeout",
		});
	});

	it("reports already_resolved for a respond that lands after expiry", async () => {
		vi.useFakeTimers();
		const ctx = createContext({ approvalTimeoutMs: 1_000 });
		ensureSessionState(ctx, "session-1", "client-1", "creator", {
			interactive: true,
		});
		const { approvalId, result } = await startApproval(ctx);
		await vi.advanceTimersByTimeAsync(1_001);
		await result;

		const reply = await respond(
			ctx,
			{ approvalId, approved: true },
			"req-late",
			"client-1",
		);
		expect(reply).toMatchObject({
			ok: false,
			error: { code: "already_resolved", details: { approvalId } },
		});
		expect(
			ctx.events.filter((event) => event.event === "approval.resolved"),
		).toHaveLength(1);
	});

	it("clears the expiry timer when the approval is answered or cancelled", async () => {
		vi.useFakeTimers();
		const ctx = createContext({ approvalTimeoutMs: 60_000 });
		ensureSessionState(ctx, "session-1", "client-1", "creator", {
			interactive: true,
		});
		const answered = await startApproval(ctx);
		const cancelled = await startApproval(ctx, { toolCallId: "call-2" });
		expect(vi.getTimerCount()).toBe(2);

		await respond(
			ctx,
			{ approvalId: answered.approvalId, approved: true },
			"req-answer",
			"client-1",
		);
		expect(vi.getTimerCount()).toBe(1);

		cancelPendingApprovals(ctx, () => true, "hub shutting down");
		expect(vi.getTimerCount()).toBe(0);
		await expect(answered.result).resolves.toMatchObject({ approved: true });
		await expect(cancelled.result).resolves.toEqual({
			approved: false,
			reason: "hub shutting down",
		});
		// No stray timer can fire a second resolution after cleanup.
		await vi.advanceTimersByTimeAsync(120_000);
		expect(
			ctx.events.filter((event) => event.event === "approval.resolved"),
		).toHaveLength(2);
	});
});
