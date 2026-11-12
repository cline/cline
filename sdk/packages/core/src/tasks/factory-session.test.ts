import type {
	AgendaTaskRecord,
	AgendaTaskRunRecord,
	FactoryAttempt,
	FactoryRunState,
	FactoryTaskConfig,
} from "@cline/shared";
import { factoryTaskConfigSchema } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	AgendaTaskRuntime,
	AgendaTaskRuntimeResult,
} from "./agenda-task-manager";
import { parseFactoryReview } from "./factory-agents";
import { FactoryDecisionError } from "./factory-errors";
import {
	createFactorySessionRunner,
	FactoryPersistenceError,
} from "./factory-session";

const validReview = JSON.stringify({
	verdict: "pass",
	summary: "Reviewed behavior",
	findings: [],
});

function setup(
	options: {
		config?: Partial<FactoryTaskConfig>;
		signal?: AbortSignal;
		failSave?: (patch: Partial<FactoryRunState>) => boolean;
		attempts?: FactoryAttempt[];
		priorCardCostUsd?: number;
		settlePolling?: { intervalMs: number; timeoutMs: number };
	} = {},
) {
	const task: AgendaTaskRecord = {
		taskId: "feature",
		type: "todo",
		status: "in_progress",
		title: "Implement feature",
		instructions: "Implement the approved requirement.",
		scope: "workspace",
		workspaceRoot: "/workspace",
		resourcePaths: [],
		priority: 3,
		availableAt: "2035-01-01T00:00:00.000Z",
		expiresAt: "2035-01-10T00:00:00.000Z",
		automationEligible: false,
		revision: 1,
		createdBy: { kind: "user" },
		updatedBy: { kind: "user" },
		createdAt: "2035-01-01T00:00:00.000Z",
		updatedAt: "2035-01-01T00:00:00.000Z",
		factory: factoryTaskConfigSchema.parse(options.config ?? {}),
	};
	const run: AgendaTaskRunRecord = {
		runId: "run",
		taskId: task.taskId,
		taskRevision: 1,
		attempt: 1,
		status: "running",
		claimedAt: "2035-01-01T00:00:00.000Z",
		createdAt: "2035-01-01T00:00:00.000Z",
		updatedAt: "2035-01-01T00:00:00.000Z",
	};
	const startSession = vi.fn<AgendaTaskRuntime["startSession"]>(
		async (_task, _run, _client, start) => ({
			sessionId: start?.sessionId ?? "unrequested",
		}),
	);
	const runSession = vi.fn<AgendaTaskRuntime["runSession"]>(async () => ({
		status: "completed",
		summary: validReview,
	}));
	const abortSession = vi.fn<AgendaTaskRuntime["abortSession"]>(async () => {});
	const reconcileSession = vi.fn<
		NonNullable<AgendaTaskRuntime["reconcileSession"]>
	>(async () => ({ status: "failed", error: "Session aborted" }));
	const runtime: AgendaTaskRuntime = {
		startSession,
		runSession,
		abortSession,
		reconcileSession,
	};
	let state: FactoryRunState = {
		phase: "reviewing",
		repairRound: 0,
		workspace: {
			path: "/worktree",
			branch: "factory/feature",
			baseBranch: "main",
			baseCommit: "base",
		},
		sessions: [],
		attempts: options.attempts,
		priorCardCostUsd: options.priorCardCostUsd,
	};
	const runner = createFactorySessionRunner({
		task,
		run,
		runtime,
		signal: options.signal ?? new AbortController().signal,
		getState: () => state,
		save: (patch) => {
			if (options.failSave?.(patch)) throw new Error("Disk full");
			state = { ...state, ...patch };
		},
		sessionStarted: () => {},
		settlePolling: options.settlePolling ?? { intervalMs: 1, timeoutMs: 20 },
	});
	const review = (validate?: (summary: string) => unknown) =>
		runner.execute(
			"reviewer:0",
			"Review the candidate.",
			{},
			"reviewer",
			validate,
		);
	const attempts = (): FactoryAttempt[] => state.attempts ?? [];
	const startedIds = () =>
		startSession.mock.calls.map(([, , , start]) => start?.sessionId);
	const runIds = () => runSession.mock.calls.map(([id]) => id);
	return {
		runtime,
		startSession,
		runSession,
		abortSession,
		reconcileSession,
		review,
		attempts,
		startedIds,
		runIds,
		state: () => state,
	};
}

const timeout = new Error("Hub run run.start timed out after 1800000ms.");

describe("thrown Factory session errors", () => {
	it.each([
		{ status: "failed", error: "Session aborted" },
		{ status: "cancelled" },
		{ status: "resumable" },
		{ status: "idle" },
		{ status: "missing" },
	] as const)("aborts, records a runtime failure and retries in a new session when reconcile reports $status", async (settled) => {
		const h = setup();
		h.runSession.mockRejectedValueOnce(timeout);
		h.reconcileSession.mockResolvedValue(settled);
		const result = await h.review();
		const [first, second] = h.startedIds();
		expect(result).toEqual({ sessionId: second, summary: validReview });
		expect(first).not.toBe(second);
		expect(h.abortSession).toHaveBeenCalledWith(
			first,
			expect.stringContaining("timed out"),
		);
		expect(h.reconcileSession).toHaveBeenCalledWith(first);
		expect(h.attempts()).toMatchObject([
			{
				sessionId: first,
				status: "failed",
				failure: "runtime",
				error: timeout.message,
			},
			{ sessionId: second, status: "completed", summary: validReview },
		]);
	});

	it("stops at maxRuntimeRetries with the last error and leaves no attempt running", async () => {
		const h = setup({ config: { maxRuntimeRetries: 1 } });
		h.runSession
			.mockRejectedValueOnce(timeout)
			.mockRejectedValueOnce(new Error("Provider unavailable"));
		await expect(h.review()).rejects.toThrow(
			"Factory reviewer retry limit reached: Provider unavailable",
		);
		// Hands-off recovery must not spend its retry on an exhausted budget.
		await expect(h.review()).rejects.toBeInstanceOf(FactoryDecisionError);
		expect(h.startSession).toHaveBeenCalledTimes(2);
		expect(h.attempts().map((attempt) => attempt.status)).toEqual([
			"failed",
			"failed",
		]);
	});

	it("retries a thrown startSession and surfaces a persistent one after the limit", async () => {
		const h = setup();
		h.reconcileSession.mockResolvedValue({ status: "missing" });
		h.startSession.mockRejectedValueOnce(new Error("Socket closed"));
		await expect(h.review()).resolves.toMatchObject({ summary: validReview });
		expect(h.attempts()).toMatchObject([
			{ status: "failed", failure: "runtime", error: "Socket closed" },
			{ status: "completed" },
		]);
		expect(h.runSession).toHaveBeenCalledTimes(1);

		const persistent = setup();
		persistent.reconcileSession.mockResolvedValue({
			status: "missing",
		});
		persistent.startSession.mockRejectedValue(
			new Error("Provider is not configured"),
		);
		await expect(persistent.review()).rejects.toThrow(
			"Factory reviewer retry limit reached: Provider is not configured",
		);
		expect(persistent.startSession).toHaveBeenCalledTimes(3);
		expect(persistent.runSession).not.toHaveBeenCalled();
	});

	it("re-throws without a new session while the old session still reports running", async () => {
		const h = setup();
		h.runSession.mockRejectedValueOnce(timeout);
		h.reconcileSession.mockResolvedValue({ status: "running" });
		await expect(h.review()).rejects.toBe(timeout);
		expect(h.abortSession).toHaveBeenCalledTimes(1);
		expect(h.reconcileSession.mock.calls.length).toBeGreaterThan(1);
		expect(h.startSession).toHaveBeenCalledTimes(1);
		expect(h.attempts()).toMatchObject([{ status: "running" }]);
	});

	it("waits while the aborted session still reports running and retries once it settles", async () => {
		const h = setup();
		h.runSession.mockRejectedValueOnce(timeout);
		h.reconcileSession
			.mockResolvedValueOnce({ status: "running" })
			.mockResolvedValueOnce({ status: "running" })
			.mockResolvedValue({ status: "resumable" });
		await expect(h.review()).resolves.toMatchObject({ summary: validReview });
		expect(h.reconcileSession).toHaveBeenCalledTimes(3);
		const [first, second] = h.startedIds();
		expect(second).not.toBe(first);
		expect(h.attempts()).toMatchObject([
			{ sessionId: first, status: "failed", failure: "runtime" },
			{ sessionId: second, status: "completed" },
		]);
	});

	it("re-throws when reconciliation itself fails", async () => {
		const h = setup();
		h.runSession.mockRejectedValueOnce(timeout);
		h.reconcileSession.mockRejectedValue(new Error("Hub offline"));
		await expect(h.review()).rejects.toBe(timeout);
		expect(h.startSession).toHaveBeenCalledTimes(1);
		expect(h.attempts()).toMatchObject([{ status: "running" }]);
	});

	it("adopts a result the session completed despite the throw, without a second session", async () => {
		const h = setup();
		h.runSession.mockRejectedValueOnce(timeout);
		h.reconcileSession.mockResolvedValue({
			status: "completed",
			summary: "Late result",
		});
		expect(await h.review()).toEqual({
			sessionId: h.startedIds()[0],
			summary: "Late result",
		});
		expect(h.startSession).toHaveBeenCalledTimes(1);
		expect(h.runSession).toHaveBeenCalledTimes(1);
		expect(h.attempts()).toMatchObject([
			{ status: "completed", summary: "Late result" },
		]);
	});

	it("re-throws as before when the runtime cannot reconcile", async () => {
		const h = setup();
		h.runtime.reconcileSession = undefined;
		h.runSession.mockRejectedValueOnce(timeout);
		await expect(h.review()).rejects.toBe(timeout);
		expect(h.startSession).toHaveBeenCalledTimes(1);
		expect(h.attempts()).toMatchObject([{ status: "running" }]);
	});

	it("re-throws without recording anything when cancelled during the throw", async () => {
		const controller = new AbortController();
		const h = setup({ signal: controller.signal });
		h.runSession.mockImplementationOnce(async () => {
			controller.abort();
			throw timeout;
		});
		await expect(h.review()).rejects.toBe(timeout);
		expect(h.reconcileSession).not.toHaveBeenCalled();
		expect(h.startSession).toHaveBeenCalledTimes(1);
		expect(h.attempts()).toMatchObject([{ status: "running" }]);
	});

	it("re-throws persistence failures without recording anything", async () => {
		let failed = false;
		const h = setup({
			failSave: (patch) => {
				if (failed) return false;
				failed = Boolean(
					patch.attempts?.some((attempt) => attempt.status === "running"),
				);
				return failed;
			},
		});
		await expect(h.review()).rejects.toBeInstanceOf(FactoryPersistenceError);
		expect(h.abortSession).not.toHaveBeenCalled();
		expect(h.reconcileSession).not.toHaveBeenCalled();
		expect(h.runSession).not.toHaveBeenCalled();
		expect(h.attempts()).toMatchObject([{ status: "intent" }]);
	});

	it("checks the cost budget before the retry session", async () => {
		const h = setup({ config: { maxCostUsd: 1 } });
		h.runtime.getSessionUsage = vi.fn(async () => ({
			inputTokens: 100,
			outputTokens: 50,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: 1.5,
		}));
		h.runSession.mockRejectedValueOnce(timeout);
		const refused = h.review();
		await expect(refused).rejects.toThrow(
			"This card reached its $1 spending limit. Raise the limit or stop here.",
		);
		// A spending stop is a decision: no automatic retry spends more.
		await expect(refused).rejects.toBeInstanceOf(FactoryDecisionError);
		expect(h.startSession).toHaveBeenCalledTimes(1);
		expect(h.attempts()).toMatchObject([
			{ status: "failed", failure: "runtime" },
		]);
	});

	it("counts the card's earlier runs toward its limit before the first session", async () => {
		const h = setup({ config: { maxCostUsd: 2 }, priorCardCostUsd: 2 });
		h.runtime.getSessionUsage = vi.fn(async () => undefined);
		await expect(h.review()).rejects.toThrow("$2 spending limit");
		expect(h.startSession).not.toHaveBeenCalled();
	});

	it("counts a session with unknown usage against the limit instead of zero", async () => {
		const done: FactoryAttempt = {
			id: "earlier",
			key: "build",
			role: "builder",
			repairRound: 0,
			createdAt: "2035-01-01T00:00:00.000Z",
			sessionId: "earlier",
			instructions: "",
			agent: {},
			status: "completed",
			summary: "done",
			completedAt: "2035-01-01T00:00:00.000Z",
		};
		const admitted = setup({
			config: { maxCostUsd: 1.5 },
			attempts: [done],
		});
		await expect(admitted.review()).resolves.toBeDefined();
		const refused = setup({
			config: { maxCostUsd: 1.5 },
			attempts: [done],
			priorCardCostUsd: 0.6,
		});
		await expect(refused.review()).rejects.toThrow("$1.5 spending limit");
	});

	it("starts no new session while the Hub-wide daily limit is reached", async () => {
		const h = setup();
		h.runtime.factoryAdmissionBlocker = vi.fn(
			async () => "Daily limit reached.",
		);
		await expect(h.review()).rejects.toBeInstanceOf(FactoryDecisionError);
		expect(h.startSession).not.toHaveBeenCalled();
	});

	it("applies the built-in limit to hands-off cards", async () => {
		const h = setup({
			config: { autonomy: "hands_off" },
			priorCardCostUsd: 9.99,
		});
		await expect(h.review()).resolves.toBeDefined();
		const over = setup({
			config: { autonomy: "hands_off" },
			priorCardCostUsd: 10,
		});
		await expect(over.review()).rejects.toThrow("$10 spending limit");
		// A card without autonomy or a limit is not capped.
		const manual = setup({ priorCardCostUsd: 1_000 });
		await expect(manual.review()).resolves.toBeDefined();
	});
});

describe("malformed output", () => {
	const reply = (summary: string): AgendaTaskRuntimeResult => ({
		status: "completed",
		summary,
	});

	it("records failed output and retries in a fresh session without a repair turn", async () => {
		const h = setup();
		h.runSession.mockResolvedValueOnce(reply("Looks good to me."));
		await expect(h.review(parseFactoryReview)).resolves.toMatchObject({
			summary: validReview,
		});
		const [first, second] = h.startedIds();
		expect(second).not.toBe(first);
		expect(h.runIds()).toEqual([first, second]);
		expect(
			h.runSession.mock.calls.map(([, assigned]) => assigned.instructions),
		).toEqual(["Review the candidate.", "Review the candidate."]);
		expect(h.attempts()).toMatchObject([
			{
				sessionId: first,
				status: "failed",
				failure: "output",
				error: expect.stringContaining("Unexpected token"),
			},
			{ sessionId: second, status: "completed" },
		]);
		expect(h.abortSession).not.toHaveBeenCalled();
		expect(h.reconcileSession).not.toHaveBeenCalled();
	});

	it("spends one session per malformed attempt up to the retry limit", async () => {
		const h = setup({ config: { maxRuntimeRetries: 1 } });
		h.runSession.mockResolvedValue(reply("Never JSON."));
		await expect(h.review(parseFactoryReview)).rejects.toThrow(
			"Factory reviewer retry limit reached",
		);
		expect(h.runSession).toHaveBeenCalledTimes(2);
		expect(new Set(h.runIds()).size).toBe(2);
	});
});

describe("settle polling bound", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("polls every second for up to a minute, then blocks without a new session", async () => {
		vi.useFakeTimers();
		const h = setup({ settlePolling: { intervalMs: 1000, timeoutMs: 60_000 } });
		h.runSession.mockRejectedValueOnce(timeout);
		h.reconcileSession.mockResolvedValue({ status: "running" });
		let outcome: unknown;
		void h.review().then(
			() => {
				outcome = "resolved";
			},
			(error) => {
				outcome = error;
			},
		);
		await vi.advanceTimersByTimeAsync(59_999);
		expect(outcome).toBeUndefined();
		expect(h.reconcileSession).toHaveBeenCalledTimes(60);
		await vi.advanceTimersByTimeAsync(1);
		await vi.waitFor(() => expect(outcome).toBe(timeout));
		expect(h.reconcileSession).toHaveBeenCalledTimes(61);
		expect(h.startSession).toHaveBeenCalledTimes(1);
		expect(h.attempts()).toMatchObject([{ status: "running" }]);
	});

	it("stops waiting when the run is cancelled", async () => {
		vi.useFakeTimers();
		const controller = new AbortController();
		const h = setup({
			signal: controller.signal,
			settlePolling: { intervalMs: 1000, timeoutMs: 60_000 },
		});
		h.runSession.mockRejectedValueOnce(timeout);
		h.reconcileSession.mockResolvedValue({ status: "running" });
		const outcome = h.review().catch((error: unknown) => error);
		await vi.advanceTimersByTimeAsync(2500);
		controller.abort();
		expect(await outcome).toBe(timeout);
		expect(h.reconcileSession).toHaveBeenCalledTimes(3);
		expect(h.startSession).toHaveBeenCalledTimes(1);
	});
});

describe("spending limits while a session runs", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	const usage = (totalCost: number) => ({
		inputTokens: 1000,
		outputTokens: 100,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		totalCost,
	});

	/** A session that runs until aborted, its reported cost rising each poll. */
	function running(h: ReturnType<typeof setup>, cost: () => number) {
		let finish: ((result: AgendaTaskRuntimeResult) => void) | undefined;
		h.runSession.mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		h.abortSession.mockImplementation(async () => {
			finish?.({ status: "cancelled", error: "Aborted" });
		});
		h.runtime.getSessionUsage = vi.fn(async () => usage(cost()));
		return { finish: (result: AgendaTaskRuntimeResult) => finish?.(result) };
	}

	it("aborts a session that crosses the card's limit and stops with the spending-limit reason", async () => {
		vi.useFakeTimers();
		const h = setup({ config: { maxCostUsd: 2 } });
		let cost = 0;
		running(h, () => cost);
		const outcome = h.review().catch((error: unknown) => error);
		await vi.advanceTimersByTimeAsync(30_000);
		expect(h.abortSession).not.toHaveBeenCalled();
		cost = 2.5;
		await vi.advanceTimersByTimeAsync(30_000);
		const error = await outcome;
		expect(error).toBeInstanceOf(FactoryDecisionError);
		expect((error as Error).message).toBe(
			"This card reached its $2 spending limit. Raise the limit or stop here.",
		);
		expect(h.abortSession).toHaveBeenCalledWith(
			h.startedIds()[0],
			(error as Error).message,
		);
		// A decision: no second session, the stopped attempt keeps its usage.
		expect(h.startSession).toHaveBeenCalledTimes(1);
		expect(h.attempts()).toMatchObject([
			{ status: "failed", error: (error as Error).message, usage: usage(2.5) },
		]);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("aborts a session once the Hub-wide daily limit is reached and stops with its reason", async () => {
		vi.useFakeTimers();
		const h = setup();
		running(h, () => 0.1);
		let daily: string | undefined;
		h.runtime.factoryAdmissionBlocker = vi.fn(async () => daily);
		const outcome = h.review().catch((error: unknown) => error);
		await vi.advanceTimersByTimeAsync(30_000);
		expect(h.abortSession).not.toHaveBeenCalled();
		daily = "Factory reached its $50 daily spending limit.";
		await vi.advanceTimersByTimeAsync(30_000);
		const error = await outcome;
		expect(error).toBeInstanceOf(FactoryDecisionError);
		expect((error as Error).message).toBe(daily);
		expect(h.startSession).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("leaves a session under its limits running and clears the check when it completes", async () => {
		vi.useFakeTimers();
		const h = setup({ config: { maxCostUsd: 5 } });
		const session = running(h, () => 1);
		h.runtime.factoryAdmissionBlocker = vi.fn(async () => undefined);
		const outcome = h.review();
		await vi.advanceTimersByTimeAsync(120_000);
		expect(h.abortSession).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(1);
		session.finish({ status: "completed", summary: validReview });
		await expect(outcome).resolves.toMatchObject({ summary: validReview });
		expect(vi.getTimerCount()).toBe(0);
		// Admission plus one check per 30 s while it ran.
		expect(h.runtime.factoryAdmissionBlocker).toHaveBeenCalledTimes(5);
	});

	it("counts nothing for sessions that never started", async () => {
		const h = setup({ config: { maxCostUsd: 1 } });
		h.runtime.getSessionUsage = vi.fn(async () => undefined);
		h.reconcileSession.mockResolvedValue({ status: "missing" });
		h.startSession.mockRejectedValue(new Error("Provider unavailable"));
		await expect(h.review()).rejects.toThrow(
			"Factory reviewer retry limit reached: Provider unavailable",
		);
		// Three failed starts, none refused for spending: no session ran.
		expect(h.startSession).toHaveBeenCalledTimes(3);
		expect(h.state().sessions).toEqual([]);
		expect(h.state().usage?.unknownSessionIds).toEqual([]);
	});

	it("still counts a session the runtime created before its start threw", async () => {
		const h = setup({ config: { maxCostUsd: 1 } });
		h.runtime.getSessionUsage = vi.fn(async () => undefined);
		h.reconcileSession.mockResolvedValue({ status: "resumable" });
		h.startSession.mockRejectedValueOnce(new Error("Socket closed"));
		await expect(h.review()).rejects.toThrow("$1 spending limit");
		expect(h.startSession).toHaveBeenCalledTimes(1);
	});
});

describe("recorded session models", () => {
	it("records the model the session reports without changing the frozen agent", async () => {
		const h = setup();
		h.runtime.getSessionModel = vi.fn(async () => ({
			providerId: "openrouter",
			modelId: "openai/gpt-5",
		}));
		await h.review();
		expect(h.attempts()).toMatchObject([
			{
				status: "completed",
				agent: {},
				sessionModel: { providerId: "openrouter", modelId: "openai/gpt-5" },
			},
		]);
	});
});
