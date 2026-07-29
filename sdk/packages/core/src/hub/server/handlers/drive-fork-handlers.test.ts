import type { HubCommandEnvelope, HubEventEnvelope } from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HubTransportContext } from "./context";
import {
	__resetDriveForkRoomsForTests,
	handleDriveForkCommand,
} from "./drive-fork-handlers";

function envelope(
	command: HubCommandEnvelope["command"],
	payload?: Record<string, unknown>,
): HubCommandEnvelope {
	return {
		version: "v1",
		command,
		requestId: "req-1",
		payload,
	};
}

function createCtx() {
	const published: HubEventEnvelope[] = [];
	const messagesBySession = new Map<string, unknown[]>();
	const ctx = {
		clients: new Map(),
		sessionState: new Map(),
		pendingApprovals: new Map(),
		pendingCapabilityRequests: new Map(),
		suppressNextTerminalEventBySession: new Map(),
		sessionHost: {
			startSession: vi.fn(async (input: { config?: { sessionId?: string } }) => {
				const sessionId = input.config?.sessionId ?? "worker-generated";
				messagesBySession.set(sessionId, [
					{ role: "user", content: "seed" },
					{ role: "assistant", content: "worked" },
				]);
				return {
					sessionId,
					manifest: {},
					manifestPath: "",
					messagesPath: "",
				};
			}),
			abort: vi.fn(async () => undefined),
			runTurn: vi.fn(async () => undefined),
			deleteSession: vi.fn(async () => true),
			readSessionMessages: vi.fn(async (sessionId: string) => {
				return messagesBySession.get(sessionId) ?? [];
			}),
		},
		publish: (event: HubEventEnvelope) => {
			published.push(event);
		},
		buildEvent: (
			event: HubEventEnvelope["event"],
			payload?: Record<string, unknown>,
		) =>
			({
				version: "v1",
				event,
				payload,
			}) as unknown as HubEventEnvelope,
		requestCapability: vi.fn(),
	} as unknown as HubTransportContext;
	return { ctx, published };
}

const doItem = {
	id: "do-1",
	title: "Fix flake",
	goal: "Stabilize auth",
	priority: 10,
	status: "queued" as const,
	dependsOn: [] as string[],
	source: "planner" as const,
};

describe("handleDriveForkCommand", () => {
	beforeEach(() => {
		__resetDriveForkRoomsForTests();
	});

	it("claims and spawns a path_disjoint worker", async () => {
		const { ctx, published } = createCtx();
		const reply = await handleDriveForkCommand(
			ctx,
			envelope("drive.fork.claim", {
				roomId: "r1",
				parentSessionId: "sess-main",
				assigneeParticipantId: "agent-1",
				parentBriefing: "Keep auth green",
				doItem,
				workspace: { mode: "path_disjoint" },
				allowedPathPrefixes: ["src/auth"],
				reason: "do_claim",
			}),
		);
		expect(reply.ok).toBe(true);
		const room = reply.payload?.room as {
			chatForks: Array<{ lifecycle: string; seed: { doItemId: string } }>;
		};
		expect(room.chatForks).toHaveLength(1);
		expect(room.chatForks[0]?.lifecycle).toBe("running");
		expect(room.chatForks[0]?.seed.doItemId).toBe("do-1");
		expect(
			published.some((event) => event.event === "drive.fork.changed"),
		).toBe(true);
	});

	it("rejects overlapping path_disjoint claims", async () => {
		const { ctx } = createCtx();
		const first = await handleDriveForkCommand(
			ctx,
			envelope("drive.fork.claim", {
				roomId: "r1",
				parentSessionId: "sess-main",
				assigneeParticipantId: "agent-1",
				doItem,
				workspace: { mode: "path_disjoint" },
				allowedPathPrefixes: ["src/auth"],
			}),
		);
		expect(first.ok).toBe(true);
		const second = await handleDriveForkCommand(
			ctx,
			envelope("drive.fork.claim", {
				roomId: "r1",
				parentSessionId: "sess-main",
				assigneeParticipantId: "agent-2",
				doItem: { ...doItem, id: "do-2", title: "Other" },
				workspace: { mode: "path_disjoint" },
				allowedPathPrefixes: ["src/auth/login"],
			}),
		);
		expect(second.ok).toBe(false);
		expect(second.error?.code).toBe("path_overlap");
	});

	it("promotes into director and injects parent summary", async () => {
		const { ctx, published } = createCtx();
		const claim = await handleDriveForkCommand(
			ctx,
			envelope("drive.fork.claim", {
				roomId: "r1",
				parentSessionId: "sess-main",
				assigneeParticipantId: "agent-1",
				doItem,
				workspace: { mode: "shared_readonly" },
			}),
		);
		const fork = claim.payload?.fork as { workerSessionId: string };
		const promote = await handleDriveForkCommand(
			ctx,
			envelope("drive.fork.promote", {
				roomId: "r1",
				promote: {
					workerSessionId: fork.workerSessionId,
					doItemId: "do-1",
					status: "done",
					summary: "Flake fixed",
					decisions: ["Prefer waitFor"],
					showItemIds: [],
					eventRefs: [],
					auditHandle: fork.workerSessionId,
					retainForAudit: false,
				},
			}),
		);
		expect(promote.ok).toBe(true);
		const room = promote.payload?.room as {
			director: { doBacklog: Array<{ status: string }> };
			chatForks: Array<{ lifecycle: string }>;
		};
		expect(room.director.doBacklog[0]?.status).toBe("done");
		expect(room.chatForks[0]?.lifecycle).toBe("dropped");
		expect(promote.payload?.mainContextInjection).toContain("Flake fixed");
		expect(
			published.some((event) => event.event === "drive.fork.promoted"),
		).toBe(true);
		expect(ctx.sessionHost.runTurn).toHaveBeenCalled();
		expect(ctx.sessionHost.deleteSession).toHaveBeenCalledWith(
			fork.workerSessionId,
		);
	});

	it("cancels via promote cancelled", async () => {
		const { ctx } = createCtx();
		const claim = await handleDriveForkCommand(
			ctx,
			envelope("drive.fork.claim", {
				roomId: "r1",
				parentSessionId: "sess-main",
				assigneeParticipantId: "agent-1",
				doItem,
				workspace: { mode: "shared_readonly" },
			}),
		);
		const fork = claim.payload?.fork as { workerSessionId: string };
		const cancel = await handleDriveForkCommand(
			ctx,
			envelope("drive.fork.cancel", {
				roomId: "r1",
				workerSessionId: fork.workerSessionId,
			}),
		);
		expect(cancel.ok).toBe(true);
		const room = cancel.payload?.room as {
			director: { doBacklog: Array<{ status: string }> };
		};
		expect(room.director.doBacklog[0]?.status).toBe("blocked");
	});

	it("returns audit messages while retained", async () => {
		const { ctx } = createCtx();
		const claim = await handleDriveForkCommand(
			ctx,
			envelope("drive.fork.claim", {
				roomId: "r1",
				parentSessionId: "sess-main",
				assigneeParticipantId: "agent-1",
				doItem,
				workspace: { mode: "shared_readonly" },
			}),
		);
		const fork = claim.payload?.fork as { workerSessionId: string };
		await handleDriveForkCommand(
			ctx,
			envelope("drive.fork.promote", {
				roomId: "r1",
				promote: {
					workerSessionId: fork.workerSessionId,
					doItemId: "do-1",
					status: "done",
					summary: "ok",
					decisions: [],
					showItemIds: [],
					eventRefs: [],
					auditHandle: fork.workerSessionId,
					retainForAudit: true,
				},
			}),
		);
		const audit = await handleDriveForkCommand(
			ctx,
			envelope("drive.fork.audit.get", {
				roomId: "r1",
				auditHandle: fork.workerSessionId,
			}),
		);
		expect(audit.ok).toBe(true);
		expect(audit.payload?.summaryOnly).toBe(false);
		expect((audit.payload?.messages as unknown[]).length).toBeGreaterThan(0);
	});
});
