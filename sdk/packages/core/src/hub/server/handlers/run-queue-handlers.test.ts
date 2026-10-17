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
			await executor.stop();
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
			await executor.stop();
			queue.close();
		}
	});

	it("requeues an unstarted result rejected while stop is waiting, and recovers it after restart", async () => {
		let rejectBusy: (error: Error) => void = () => {};
		let entered: () => void = () => {};
		const reached = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const blocked = new Promise<never>((_, reject) => {
			rejectBusy = reject;
		});
		const runTurn = vi.fn(() => {
			entered();
			return blocked;
		});
		const queue = new HubRunQueue({ dbPath: ":memory:" });
		const admitted = queue.admit("origin", {
			prompt: "result",
			delivery: "immediate",
		});
		const executor = new HubRunExecutor(context(runTurn), queue);
		try {
			executor.pump("origin");
			await reached;
			expect(queue.get(admitted.runId)?.state).toBe("running");
			const stopped = executor.stop();
			rejectBusy(
				Object.assign(new Error("busy"), { code: "session_run_in_progress" }),
			);
			await stopped;
			expect(queue.get(admitted.runId)?.state).toBe("queued");
			const recovered = queue.recoverOnStartup();
			expect(recovered.interrupted).toEqual([]);
			expect(recovered.requeued.map((run) => run.runId)).toEqual([
				admitted.runId,
			]);
			expect(runTurn).toHaveBeenCalledOnce();
		} finally {
			await executor.stop();
			queue.close();
		}
	});

	it("waits for restoration before host disposal without starting an unadmitted turn", async () => {
		let release: () => void = () => {};
		let entered: () => void = () => {};
		const barrier = new Promise<void>((resolve) => {
			release = resolve;
		});
		const reached = new Promise<void>((resolve) => {
			entered = resolve;
		});
		let prepared = false;
		const runTurn = vi.fn();
		const queue = new HubRunQueue({ dbPath: ":memory:" });
		const accepted = queue.admit("origin", {
			prompt: "result",
			delivery: "immediate",
		});
		const executor = new HubRunExecutor(context(runTurn), queue, async () => {
			entered();
			await barrier;
			prepared = true;
		});
		let stopped: Promise<void> | undefined;
		try {
			executor.pump("origin");
			await reached;
			stopped = executor.stop();
			const preparations = executor.waitForPreparations();
			release();
			await preparations;
			expect(prepared).toBe(true);
			await stopped;
			expect(runTurn).not.toHaveBeenCalled();
			expect(queue.get(accepted.runId)?.state).toBe("queued");
			expect(queue.recoverOnStartup().interrupted).toEqual([]);
		} finally {
			release();
			await stopped;
			await executor.stop();
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
		await executor.stop();
		await vi.advanceTimersByTimeAsync(5000);
		expect(queue.get(accepted.runId)?.state).toBe("queued");
		expect(runTurn).toHaveBeenCalledOnce();
		queue.close();
	});
});
