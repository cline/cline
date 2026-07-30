import type { HubCommandEnvelope, HubEventEnvelope } from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HubTransportContext } from "./context";
import {
	__resetDriveRoomsForTests,
	handleDriveCommand,
} from "./drive-handlers";
import { __resetDriveForkRoomsForTests } from "./drive-fork-handlers";
import { handleDriveForkTickCommand } from "./drive-fork-tick";

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

describe("drive.do.enqueue → drive.fork.tick", () => {
	beforeEach(() => {
		__resetDriveRoomsForTests();
		__resetDriveForkRoomsForTests();
	});

	it("claims a newly enqueued Do item without a prior claim payload", async () => {
		const { ctx, published } = createCtx();
		const enqueue = await handleDriveCommand(
			ctx,
			envelope("drive.do.enqueue", {
				roomId: "r-tick",
				doItem: {
					id: "do-new",
					title: "Ship show link",
					goal: "Prove enqueue→tick→claim",
					priority: 40,
					status: "queued",
					dependsOn: [],
					source: "planner",
				},
			}),
		);
		expect(enqueue.ok).toBe(true);

		const tick = await handleDriveForkTickCommand(
			ctx,
			envelope("drive.fork.tick", {
				roomId: "r-tick",
				parentSessionId: "sess-main",
				assigneeParticipantId: "agent-1",
				parentBriefing: "Keep green",
			}),
		);
		expect(tick.ok).toBe(true);
		expect(tick.payload?.claimed).toBe(1);
		const room = tick.payload?.room as {
			chatForks: Array<{ seed: { doItemId: string }; lifecycle: string }>;
			director: { doBacklog: Array<{ id: string; status: string }> };
		};
		expect(room.chatForks).toHaveLength(1);
		expect(room.chatForks[0]?.seed.doItemId).toBe("do-new");
		expect(room.chatForks[0]?.lifecycle).toBe("running");
		expect(room.director.doBacklog[0]?.status).toBe("active");
		expect(
			published.some((event) => event.event === "drive.fork.changed"),
		).toBe(true);
	});

	it("is a no-op when Do backlog is empty", async () => {
		const { ctx } = createCtx();
		const tick = await handleDriveForkTickCommand(
			ctx,
			envelope("drive.fork.tick", {
				roomId: "r-empty",
				parentSessionId: "sess-main",
				assigneeParticipantId: "agent-1",
			}),
		);
		expect(tick.ok).toBe(true);
		expect(tick.payload?.claimed).toBe(0);
		expect(tick.payload?.errors).toEqual([]);
		const room = tick.payload?.room as { chatForks?: unknown[] };
		expect(room.chatForks ?? []).toHaveLength(0);
	});
});
