import { afterEach, describe, expect, it, vi } from "vitest";
import { HubRunQueue } from "../hub-run-queue";
import { buildHubEvent, type HubTransportContext } from "./context";
import { HubRunExecutor } from "./run-queue-handlers";

function context(runTurn: ReturnType<typeof vi.fn>): HubTransportContext {
	return {
		sessionSearch: { removeSession: vi.fn() } as never,
		clients: new Map(),
		sessionState: new Map(),
		pendingApprovals: new Map(),
		pendingCapabilityRequests: new Map(),
		suppressNextTerminalEventBySession: new Map(),
		activeRpcTurnCountBySession: new Map(),
		sessionHost: {
			runTurn,
			getSession: vi.fn(async () => ({ sessionId: "origin" })),
			getSessionSnapshot: vi.fn(),
			readSessionMessages: vi.fn(async () => []),
		} as never,
		publish: vi.fn(),
		buildEvent: buildHubEvent,
		requestCapability: vi.fn(),
	} as HubTransportContext;
}

describe("scheduled result executor", () => {
	afterEach(() => vi.useRealTimers());
	it("retains a busy destination in the durable queue until it can execute", async () => {
		vi.useFakeTimers();
		const runTurn = vi
			.fn()
			.mockRejectedValueOnce(
				Object.assign(new Error("busy"), { code: "session_run_in_progress" }),
			)
			.mockResolvedValue(undefined);
		const queue = new HubRunQueue({ dbPath: ":memory:" });
		const accepted = queue.admit(
			"origin",
			{ prompt: "result", delivery: "immediate" },
			undefined,
			"schedule-result:r1",
		);
		const prepare = vi.fn(async () => {});
		const executor = new HubRunExecutor(context(runTurn), queue, prepare);
		try {
			executor.pump("origin");
			await vi.advanceTimersByTimeAsync(0);
			expect(queue.get(accepted.runId)?.state).toBe("queued");
			expect(runTurn).toHaveBeenCalledOnce();
			await vi.advanceTimersByTimeAsync(1000);
			expect(queue.get(accepted.runId)?.state).toBe("completed");
			expect(runTurn).toHaveBeenCalledTimes(2);
			expect(prepare).toHaveBeenCalledTimes(2);
		} finally {
			executor.stop();
			queue.close();
		}
	});

	it("records a missing destination failure instead of creating another session", async () => {
		const runTurn = vi.fn();
		const queue = new HubRunQueue({ dbPath: ":memory:" });
		const accepted = queue.admit("deleted", { prompt: "result" });
		const executor = new HubRunExecutor(context(runTurn), queue, async () => {
			throw new Error("Destination deleted");
		});
		try {
			executor.pump("deleted");
			await expect.poll(() => queue.get(accepted.runId)?.state).toBe("failed");
			expect(runTurn).not.toHaveBeenCalled();
			expect(queue.get(accepted.runId)?.error).toContain("deleted");
		} finally {
			executor.stop();
			queue.close();
		}
	});

	it("leaves a busy delivery queued when the Hub stops", async () => {
		vi.useFakeTimers();
		const runTurn = vi
			.fn()
			.mockRejectedValue(
				Object.assign(new Error("busy"), { code: "session_run_in_progress" }),
			);
		const queue = new HubRunQueue({ dbPath: ":memory:" });
		const accepted = queue.admit("origin", {
			prompt: "result",
			delivery: "immediate",
		});
		const executor = new HubRunExecutor(context(runTurn), queue);
		executor.pump("origin");
		await vi.advanceTimersByTimeAsync(0);
		executor.stop();
		await vi.advanceTimersByTimeAsync(5000);
		expect(queue.get(accepted.runId)?.state).toBe("queued");
		expect(runTurn).toHaveBeenCalledOnce();
		queue.close();
	});
});
