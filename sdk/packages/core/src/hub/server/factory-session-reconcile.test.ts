import type { HubEventEnvelope } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeHost } from "../../runtime/host/runtime-host";
import type { SessionRecord } from "../../types/sessions";
import { reconcileFactorySession } from "./factory-session-reconcile";
import { buildHubEvent, type HubTransportContext } from "./handlers/context";
import { handleSessionInput } from "./handlers/run-handlers";
import { projectSessionEvent } from "./handlers/session-event-projector";

function createContext(session: Partial<SessionRecord>) {
	let finishRun: (result: undefined) => void = () => {};
	const runTurn = vi.fn(
		() =>
			new Promise<undefined>((resolve) => {
				finishRun = resolve;
			}),
	);
	const events: HubEventEnvelope[] = [];
	const ctx: HubTransportContext = {
		sessionSearch: { removeSession: vi.fn() } as never,
		clients: new Map(),
		sessionState: new Map(),
		pendingApprovals: new Map(),
		pendingCapabilityRequests: new Map(),
		suppressNextTerminalEventBySession: new Map(),
		activeRpcTurnCountBySession: new Map(),
		abandonedRpcTurnCountBySession: new Map(),
		runDeadlinesBySession: new Map(),
		sessionHost: {
			startSession: vi.fn(),
			runTurn,
			restoreSession: vi.fn(),
			abort: vi.fn().mockResolvedValue(undefined),
			stopSession: vi.fn(),
			dispose: vi.fn(),
			getSession: vi.fn(async (sessionId: string) => ({
				...session,
				sessionId,
			})),
			listSessions: vi.fn(),
		} as unknown as RuntimeHost,
		publish: (event) => events.push(event),
		buildEvent: buildHubEvent,
		requestCapability: vi.fn(),
	};
	return { ctx, events, finishRun: () => finishRun(undefined) };
}

async function timeOutTurn(ctx: HubTransportContext) {
	const reply = handleSessionInput(ctx, {
		version: "v1",
		command: "run.start",
		requestId: "req-timeout",
		sessionId: "session-1",
		payload: { sessionId: "session-1", prompt: "go", timeoutMs: 50 },
	});
	const rejected = expect(reply).rejects.toThrow(
		"Hub run run.start timed out after 50ms.",
	);
	await vi.advanceTimersByTimeAsync(51);
	await rejected;
}

describe("Factory session reconciliation", () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("reports a timed-out turn as running until its run settles, then resumable", async () => {
		vi.useFakeTimers();
		vi.spyOn(console, "error").mockImplementation(() => {});
		const session: Partial<SessionRecord> = { status: "running" };
		const { ctx, finishRun } = createContext(session);
		await timeOutTurn(ctx);
		expect(ctx.sessionHost.abort).toHaveBeenCalledWith(
			"session-1",
			"Hub run run.start timed out after 50ms.",
		);
		await expect(reconcileFactorySession(ctx, "session-1")).resolves.toEqual({
			status: "running",
		});
		session.status = "cancelled";
		finishRun();
		await vi.advanceTimersByTimeAsync(0);
		await expect(reconcileFactorySession(ctx, "session-1")).resolves.toEqual({
			status: "resumable",
		});
	});

	it("keeps an abandoned turn running past the unwind grace until its run settles", async () => {
		vi.useFakeTimers();
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		const session: Partial<SessionRecord> = { status: "running" };
		const { ctx, events, finishRun } = createContext(session);
		await timeOutTurn(ctx);
		const failedBefore = events.filter(
			(event) => event.event === "run.failed",
		).length;

		await vi.advanceTimersByTimeAsync(5 * 60_000);
		expect(String(logged.mock.calls)).toContain("run.unwind_abandoned");
		// Idle/status accounting is released, but the run may still be writing.
		expect(ctx.activeRpcTurnCountBySession.has("session-1")).toBe(false);
		expect(ctx.abandonedRpcTurnCountBySession.get("session-1")).toBe(1);
		await expect(reconcileFactorySession(ctx, "session-1")).resolves.toEqual({
			status: "running",
		});

		// A late agent error from the abandoned turn is not a second run failure.
		await projectSessionEvent(ctx, {
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				event: {
					type: "error",
					error: new Error("late provider failure"),
					recoverable: false,
					iteration: 0,
				},
			},
		});
		expect(events.filter((event) => event.event === "run.failed")).toHaveLength(
			failedBefore,
		);

		session.status = "cancelled";
		finishRun();
		await vi.advanceTimersByTimeAsync(0);
		expect(ctx.abandonedRpcTurnCountBySession.has("session-1")).toBe(false);
		await expect(reconcileFactorySession(ctx, "session-1")).resolves.toEqual({
			status: "resumable",
		});
	});

	it("reports running over a result an earlier turn persisted", async () => {
		vi.useFakeTimers();
		vi.spyOn(console, "error").mockImplementation(() => {});
		const persisted = { status: "completed", summary: "Earlier response" };
		const { ctx, finishRun } = createContext({
			status: "running",
			metadata: { factoryRuntimeResult: persisted },
		});
		await timeOutTurn(ctx);
		await expect(reconcileFactorySession(ctx, "session-1")).resolves.toEqual({
			status: "running",
		});
		finishRun();
		await vi.advanceTimersByTimeAsync(0);
		await expect(reconcileFactorySession(ctx, "session-1")).resolves.toEqual(
			persisted,
		);
	});

	it("reports a missing session", async () => {
		const { ctx } = createContext({});
		vi.mocked(ctx.sessionHost.getSession).mockResolvedValue(undefined);
		await expect(reconcileFactorySession(ctx, "session-1")).resolves.toEqual({
			status: "missing",
		});
	});

	it.each([
		[{ status: "idle" }, { status: "resumable" }],
		[
			{
				status: "cancelled",
				metadata: { factoryRuntimeResult: { status: "cancelled" } },
			},
			{ status: "resumable" },
		],
		[
			{ status: "completed" },
			{
				status: "failed",
				error: "Factory session ended without a durable completion result",
			},
		],
	] satisfies Array<
		[Partial<SessionRecord>, unknown]
	>)("reconciles a session without an active turn: %j", async (session, expected) => {
		const { ctx } = createContext(session);
		await expect(reconcileFactorySession(ctx, "session-1")).resolves.toEqual(
			expected,
		);
	});
});
