/**
 * Vertical-slice coverage for the Hub's app-server upgrades: durable
 * sequence-stamped events with cursor replay, queue-backed run admission
 * with an immediate ack, the drain lifecycle, and pending-approval re-issue
 * on (re)subscribe.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HubEventEnvelope } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";

vi.mock("@ai-sdk/provider-utils", () => ({
	createProviderDefinedToolFactory: vi.fn(() => vi.fn()),
}));

import type {
	StartSessionInput,
	StartSessionResult,
} from "../../runtime/host/runtime-host";
import type { HubTransportContext } from "./handlers/context";
import { HubServerTransport } from "./hub-server-transport";

function createStartedTransportOptions() {
	const root = mkdtempSync(join(tmpdir(), "cline-hub-upgrades-"));
	const sessions = new Map<string, Record<string, unknown>>();
	const capturedStarts: StartSessionInput[] = [];
	const startSession = vi.fn(
		async (input: StartSessionInput): Promise<StartSessionResult> => {
			capturedStarts.push(input);
			const sessionId = input.config.sessionId ?? "session-x";
			sessions.set(sessionId, {
				sessionId,
				source: "core",
				status: "running",
				startedAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				interactive: input.interactive === true,
				provider: input.config.providerId,
				model: input.config.modelId,
				cwd: input.config.cwd ?? root,
				workspaceRoot: input.config.workspaceRoot ?? root,
			});
			return {
				sessionId,
				manifest: {
					version: 1,
					session_id: sessionId,
					source: "core",
					pid: 1,
					started_at: new Date().toISOString(),
					status: "running",
					interactive: input.interactive === true,
					provider: input.config.providerId,
					model: input.config.modelId,
					cwd: input.config.cwd ?? root,
					workspace_root: input.config.workspaceRoot ?? root,
					enable_tools: true,
					enable_spawn: true,
					enable_teams: true,
				},
				manifestPath: "",
				messagesPath: "",
			};
		},
	);
	const runTurn = vi.fn(async () => ({
		text: "done",
		finishReason: "completed" as const,
		toolCalls: [],
	}));
	return {
		root,
		sessions,
		capturedStarts,
		startSession,
		runTurn,
		options: {
			workspaceRoot: root,
			runtimeHandlers: {
				startSession: vi.fn(),
				sendSession: vi.fn(),
				abortSession: vi.fn(),
				stopSession: vi.fn(),
			},
			scheduleOptions: { dbPath: ":memory:" },
			taskOptions: {
				dbPath: join(root, "tasks.db"),
				globalSpecsDir: join(root, "specs"),
				watchFiles: false,
			},
			eventLog: { dbPath: ":memory:" },
			runQueue: { dbPath: ":memory:" },
			sessionHost: {
				subscribe: vi.fn(() => () => {}),
				startSession,
				runTurn,
				stopSession: vi.fn(async () => {}),
				abort: vi.fn(async () => {}),
				dispose: vi.fn(async () => {}),
				getSession: vi.fn(async (sessionId: string) => sessions.get(sessionId)),
				getAccumulatedUsage: vi.fn(async () => undefined),
				listSessions: vi.fn(async () => [...sessions.values()]),
				deleteSession: vi.fn(async () => false),
				updateSession: vi.fn(async () => ({ updated: false })),
				updateSessionCompactionState: vi.fn(async () => ({ updated: false })),
				readSessionCompactionState: vi.fn(async () => undefined),
				readSessionMessages: vi.fn(async () => []),
				dispatchHookEvent: vi.fn(async () => {}),
				restoreSession: vi.fn(),
			} as never,
		},
	};
}

async function waitFor(
	predicate: () => boolean | Promise<boolean>,
	timeoutMs = 2_000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!(await predicate())) {
		if (Date.now() > deadline) {
			throw new Error("condition not reached in time");
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

describe("Hub app-server upgrades", () => {
	it("stamps published events with durable sequences and replays from a cursor", async () => {
		const { options } = createStartedTransportOptions();
		const transport = new HubServerTransport(options as never);
		await transport.start();
		try {
			const seen: HubEventEnvelope[] = [];
			transport.subscribe("observer", (event) => seen.push(event));
			await transport.handleCommand({
				version: "v1",
				command: "session.create",
				clientId: "creator",
				payload: { sessionConfig: { sessionId: "replay-session" } },
			});
			await transport.handleCommand({
				version: "v1",
				command: "run.start",
				clientId: "creator",
				sessionId: "replay-session",
				payload: { prompt: "hello" },
			});
			expect(seen.length).toBeGreaterThan(0);
			for (const event of seen) {
				expect(typeof event.sequence).toBe("number");
			}
			const sequences = seen.map((event) => event.sequence ?? 0);
			expect([...sequences].sort((a, b) => a - b)).toEqual(sequences);

			// Replay from the middle of the stream returns exactly the tail.
			const cursor = sequences[0] ?? 0;
			const replay = transport.replayEventsAfter(cursor, { limit: 100 });
			expect(replay.map((event) => event.sequence)).toEqual(sequences.slice(1));
			expect(transport.lastEventSequence()).toBe(sequences.at(-1));
		} finally {
			await transport.stop();
		}
	});

	it("acks run.enqueue immediately and executes the run through the queue", async () => {
		const { options, runTurn } = createStartedTransportOptions();
		const transport = new HubServerTransport(options as never);
		await transport.start();
		try {
			const events: HubEventEnvelope[] = [];
			transport.subscribe("observer", (event) => events.push(event));
			await transport.handleCommand({
				version: "v1",
				command: "session.create",
				clientId: "creator",
				payload: { sessionConfig: { sessionId: "queued-session" } },
			});
			const reply = await transport.handleCommand({
				version: "v1",
				command: "run.enqueue",
				clientId: "creator",
				sessionId: "queued-session",
				payload: { prompt: "queued work" },
			});
			expect(reply.ok).toBe(true);
			expect(reply.payload?.runId).toMatch(/^hrun_/);
			expect(reply.payload?.queuePosition).toBe(0);
			expect(typeof reply.payload?.acceptedAt).toBe("number");

			await waitFor(() =>
				events.some((event) => event.event === "run.completed"),
			);
			expect(runTurn).toHaveBeenCalledOnce();
			expect(events.some((event) => event.event === "run.enqueued")).toBe(true);

			const listed = await transport.handleCommand({
				version: "v1",
				command: "run.list",
				sessionId: "queued-session",
			});
			expect(listed.ok).toBe(true);
			const runs = listed.payload?.runs as { state: string }[];
			expect(runs).toHaveLength(1);
			expect(runs[0]?.state).toBe("completed");
		} finally {
			await transport.stop();
		}
	});

	it("refuses new mutating work while draining, with a retryable error", async () => {
		const { options } = createStartedTransportOptions();
		const transport = new HubServerTransport(options as never);
		await transport.start();
		try {
			const drainReply = await transport.handleCommand({
				version: "v1",
				command: "hub.drain",
				payload: { reason: "test upgrade" },
			});
			expect(drainReply.ok).toBe(true);
			expect(drainReply.payload?.draining).toBe(true);
			expect(transport.isDraining()).toBe(true);

			const refused = await transport.handleCommand({
				version: "v1",
				command: "session.create",
				clientId: "creator",
				payload: {},
			});
			expect(refused.ok).toBe(false);
			expect(refused.error?.code).toBe("hub_draining");
			expect(refused.error?.details?.retryable).toBe(true);

			// Reads still work while draining.
			const status = await transport.handleCommand({
				version: "v1",
				command: "hub.status",
			});
			expect(status.ok).toBe(true);
			expect(status.payload?.draining).toBe(true);

			const undrain = await transport.handleCommand({
				version: "v1",
				command: "hub.drain",
				payload: { draining: false },
			});
			expect(undrain.payload?.draining).toBe(false);
			const allowed = await transport.handleCommand({
				version: "v1",
				command: "session.create",
				clientId: "creator",
				payload: { sessionConfig: { sessionId: "post-drain" } },
			});
			expect(allowed.ok).toBe(true);
		} finally {
			await transport.stop();
		}
	});

	it("re-issues pending approval requests to a (re)subscribing client", async () => {
		const { options } = createStartedTransportOptions();
		const transport = new HubServerTransport(options as never);
		await transport.start();
		try {
			await transport.handleCommand({
				version: "v1",
				command: "session.create",
				clientId: "creator",
				payload: {
					sessionConfig: { sessionId: "approval-session" },
					metadata: { interactive: true },
				},
			});
			const ctx = (
				transport as unknown as {
					ctx: import("./handlers/context").HubTransportContext;
				}
			).ctx;
			const { requestToolApproval } = await import(
				"./handlers/approval-handlers"
			);
			// Raise an approval while nobody is subscribed — the old Hub lost
			// this event forever and parked the turn.
			const approvalPromise = requestToolApproval(ctx, {
				sessionId: "approval-session",
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
				toolCallId: "call-1",
				toolName: "write_file",
				input: {},
				policy: "ask",
			} as never);

			const seen: HubEventEnvelope[] = [];
			transport.subscribe("late-client", (event) => seen.push(event), {
				sessionId: "approval-session",
			});
			await waitFor(() =>
				seen.some((event) => event.event === "approval.requested"),
			);
			const requested = seen.find(
				(event) => event.event === "approval.requested",
			);
			const approvalId = requested?.payload?.approvalId as string;
			const respond = await transport.handleCommand({
				version: "v1",
				command: "approval.respond",
				clientId: "late-client",
				payload: { approvalId, approved: true },
			});
			expect(respond.ok).toBe(true);
			await expect(approvalPromise).resolves.toEqual({
				approved: true,
				reason: undefined,
			});
		} finally {
			await transport.stop();
		}
	});

	it("recovers queued runs and interrupts orphaned running runs across a restart", async () => {
		const { options } = createStartedTransportOptions();
		const root = mkdtempSync(join(tmpdir(), "cline-hub-recovery-"));
		const runsDb = join(root, "hub-runs.db");
		// First hub generation: admit one run and crash before executing it.
		const { HubRunQueue } = await import("./hub-run-queue");
		const preCrash = new HubRunQueue({ dbPath: runsDb });
		const orphan = preCrash.admit("lost-session", { prompt: "was running" });
		preCrash.markRunning(orphan.runId);
		const queued = preCrash.admit("lost-session", { prompt: "still queued" });
		preCrash.close();

		// Second generation recovers on start: the orphan is interrupted, the
		// queued run re-admits (and fails cleanly because the session is gone).
		const transport = new HubServerTransport({
			...options,
			runQueue: { dbPath: runsDb },
		} as never);
		const events: HubEventEnvelope[] = [];
		transport.subscribe("observer", (event) => events.push(event));
		await transport.start();
		try {
			expect(
				events.some(
					(event) =>
						event.event === "run.interrupted" &&
						event.payload?.runId === orphan.runId,
				),
			).toBe(true);
			const listed = await transport.handleCommand({
				version: "v1",
				command: "run.list",
				sessionId: "lost-session",
			});
			const runs = listed.payload?.runs as {
				runId: string;
				state: string;
			}[];
			expect(runs.find((run) => run.runId === orphan.runId)?.state).toBe(
				"interrupted",
			);
			// The re-admitted run settles terminally (its session no longer
			// exists), never dangling as "queued" or ghost-"running".
			await waitFor(async () => {
				const relisted = await transport.handleCommand({
					version: "v1",
					command: "run.list",
					sessionId: "lost-session",
				});
				const state = (
					relisted.payload?.runs as { runId: string; state: string }[]
				).find((run) => run.runId === queued.runId)?.state;
				return state === "failed" || state === "completed";
			});
		} finally {
			await transport.stop();
		}
	});
});
