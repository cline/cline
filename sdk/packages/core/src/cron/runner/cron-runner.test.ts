import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	ChatStartSessionRequest,
	CronOneOffSpec,
	ITelemetryService,
} from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DefaultToolNames } from "../../extensions/tools/constants";
import type {
	HubScheduleRuntimeHandlers,
	HubScheduleStartSessionOptions,
} from "../service/schedule-service";
import { SqliteCronStore } from "../store/sqlite-cron-store";
import { CronMaterializer } from "./cron-materializer";
import { CronRunner } from "./cron-runner";

function fakeHandlers(): {
	handlers: HubScheduleRuntimeHandlers;
	calls: {
		start: number;
		send: number;
		stop: number;
		prompts: string[];
		startRequests: ChatStartSessionRequest[];
		startOptions: Array<HubScheduleStartSessionOptions | undefined>;
	};
} {
	const calls = {
		start: 0,
		send: 0,
		stop: 0,
		prompts: [] as string[],
		startRequests: [] as ChatStartSessionRequest[],
		startOptions: [] as Array<HubScheduleStartSessionOptions | undefined>,
	};
	const handlers: HubScheduleRuntimeHandlers = {
		async startSession(req, options) {
			calls.start += 1;
			calls.startRequests.push(req);
			calls.startOptions.push(options);
			return { sessionId: `sess_${calls.start}` };
		},
		async sendSession(_sessionId, req) {
			calls.send += 1;
			calls.prompts.push(req.prompt);
			return {
				result: {
					text: "done text",
					usage: { inputTokens: 5, outputTokens: 7, totalCost: 0.001 },
					toolCalls: [{ name: "read_file", durationMs: 1 }],
				},
			};
		},
		async abortSession(_sessionId) {
			return { applied: true };
		},
		async stopSession(_sessionId) {
			calls.stop += 1;
			return { applied: true };
		},
	};
	return { handlers, calls };
}

function requireValue<T>(value: T | undefined): T {
	expect(value).toBeDefined();
	if (value === undefined) {
		throw new Error("Expected value to be defined");
	}
	return value;
}

describe("CronRunner", () => {
	let dir: string;
	let workspaceRoot: string;
	let cronDir: string;
	let store: SqliteCronStore;
	let materializer: CronMaterializer;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "cline-runner-"));
		workspaceRoot = join(dir, "ws");
		cronDir = join(dir, "cron-specs");
		mkdirSync(workspaceRoot, { recursive: true });
		store = new SqliteCronStore({ dbPath: join(dir, "cron.db") });
		materializer = new CronMaterializer({ store });
	});
	afterEach(() => {
		store.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it.each([
		false,
		true,
	])("dispatches other schedules while a run is pending (expired lease: %s)", async (expiredLease) => {
		const { handlers, calls } = fakeHandlers();
		let release!: () => void;
		const pending = new Promise<void>((resolve) => {
			release = resolve;
		});
		const sendSession = handlers.sendSession;
		handlers.sendSession = async (sessionId, request) => {
			if (request.prompt === "blocked") await pending;
			return sendSession(sessionId, request);
		};
		const enqueue = (id: string) => {
			const { record } = store.upsertSpec({
				externalId: id,
				sourcePath: `${id}.cron.md`,
				triggerKind: "schedule",
				sourceHash: "h",
				parseStatus: "valid",
				spec: {
					triggerKind: "schedule",
					id,
					title: id,
					prompt: id,
					workspaceRoot,
					enabled: true,
					schedule: "0 2 * * *",
				},
			});
			return store.enqueueRun({
				specId: record.specId,
				specRevision: record.revision,
				triggerKind: "schedule",
			});
		};
		const blocked = enqueue("blocked");
		const runner = new CronRunner({
			store,
			materializer,
			runtimeHandlers: handlers,
			workspaceRoot,
			specs: { cronSpecsDir: cronDir },
		});
		const firstTick = runner.tick();
		try {
			await expect.poll(() => calls.start).toBe(1);
			if (expiredLease) {
				const active = requireValue(store.getRun(blocked.runId));
				store.renewClaim(
					blocked.runId,
					requireValue(active.claimToken),
					new Date(Date.now() - 1000).toISOString(),
				);
			}
			const sameSchedule = enqueue("blocked");
			const otherSchedule = enqueue("other");
			await runner.tick();
			expect(store.getRun(otherSchedule.runId)?.status).toBe("done");
			for (let poll = 0; poll < 5; poll += 1) {
				await runner.tick();
				const waiting = store.getRun(sameSchedule.runId);
				expect(waiting?.status).toBe("queued");
				expect(waiting?.attemptCount).toBe(0);
				expect(waiting?.error).toBeUndefined();
			}
			expect(store.getRun(blocked.runId)?.status).toBe("running");
			expect(store.getRun(blocked.runId)?.attemptCount).toBe(1);
			expect(calls.start).toBe(2);
		} finally {
			release();
			await firstTick;
			await runner.dispose();
		}
		expect(store.getRun(blocked.runId)?.status).toBe("done");
	});

	it("starts polling without waiting for the initial agent turn", async () => {
		const { handlers, calls } = fakeHandlers();
		let release!: () => void;
		const pending = new Promise<void>((resolve) => {
			release = resolve;
		});
		handlers.sendSession = async () => {
			await pending;
			return { result: { text: "done" } };
		};
		store.upsertSpec({
			externalId: "initial",
			sourcePath: "initial.md",
			triggerKind: "one_off",
			sourceHash: "h",
			parseStatus: "valid",
			spec: {
				triggerKind: "one_off",
				id: "initial",
				title: "Initial",
				prompt: "Run",
				workspaceRoot,
				enabled: true,
			},
		});
		const runner = new CronRunner({
			store,
			materializer,
			runtimeHandlers: handlers,
			workspaceRoot,
			specs: { cronSpecsDir: cronDir },
		});
		let started = false;
		const start = runner.start().then(() => {
			started = true;
		});
		try {
			await expect.poll(() => started).toBe(true);
			await expect.poll(() => calls.start).toBe(1);
		} finally {
			release();
			await start;
			await expect.poll(() => runner.getActiveRuns().length).toBe(0);
			await runner.dispose();
		}
	});

	it("executes a queued one-off run end-to-end and writes a report", async () => {
		const capture = vi.fn();
		const { handlers, calls } = fakeHandlers();
		const upserted = store.upsertSpec({
			externalId: "cleanup",
			sourcePath: "cleanup.md",
			triggerKind: "one_off",
			sourceHash: "h",
			parseStatus: "valid",
			spec: {
				triggerKind: "one_off",
				id: "cleanup",
				title: "Clean",
				prompt: "Do it",
				workspaceRoot,
				enabled: true,
				modelSelection: { providerId: "p", modelId: "m" },
			},
		});
		store.updateSpecNextRunAt(
			upserted.record.specId,
			new Date(Date.now() - 1_000).toISOString(),
		);
		const runner = new CronRunner({
			store,
			materializer,
			runtimeHandlers: handlers,
			telemetry: { capture } as unknown as ITelemetryService,
			workspaceRoot,
			specs: { cronSpecsDir: cronDir },
			pollIntervalMs: 10_000,
		});
		await runner.tick();
		await runner.dispose();

		expect(capture.mock.calls.map(([event]) => event)).toEqual([
			{
				event: "schedule.run_started",
				properties: {
					triggerKind: "one_off",
					attemptCount: 1,
					startDelayMs: expect.any(Number),
				},
			},
			{
				event: "schedule.run_finished",
				properties: {
					triggerKind: "one_off",
					attemptCount: 1,
					startDelayMs: expect.any(Number),
					durationMs: expect.any(Number),
					outcome: "success",
				},
			},
		]);
		expect(calls.start).toBe(1);
		expect(calls.send).toBe(1);
		expect(calls.stop).toBe(1);
		expect(calls.startRequests[0]?.mode).toBe("yolo");
		expect(calls.startRequests[0]?.toolPolicies?.["*"]).toEqual({
			autoApprove: true,
		});
		expect(
			calls.startRequests[0]?.toolPolicies?.[DefaultToolNames.ASK],
		).toEqual({ enabled: false, autoApprove: true });
		expect(
			calls.startRequests[0]?.toolPolicies?.[DefaultToolNames.SUBMIT_AND_EXIT],
		).toEqual({ enabled: true, autoApprove: true });

		const run = requireValue(
			store.listRuns({ specId: upserted.record.specId })[0],
		);
		expect(run.status).toBe("done");
		expect(store.getSpec(upserted.record.specId)?.nextRunAt).toBeUndefined();
		const reportPath = requireValue(run.reportPath);
		expect(existsSync(reportPath)).toBe(true);
	});

	it("falls back to yolo for an unknown mode and disables questions", async () => {
		const { handlers, calls } = fakeHandlers();
		const upserted = store.upsertSpec({
			externalId: "headless-unknown",
			sourcePath: "headless-unknown.md",
			triggerKind: "one_off",
			sourceHash: "h",
			parseStatus: "valid",
			spec: {
				triggerKind: "one_off",
				id: "headless-unknown",
				title: "Headless unknown",
				prompt: "Do it",
				workspaceRoot,
				enabled: true,
				mode: "unknown" as CronOneOffSpec["mode"],
				tools: [DefaultToolNames.ASK, DefaultToolNames.READ_FILES],
			},
		});
		store.updateSpecNextRunAt(
			upserted.record.specId,
			new Date(Date.now() - 1_000).toISOString(),
		);
		const runner = new CronRunner({
			store,
			materializer,
			runtimeHandlers: handlers,
			workspaceRoot,
			specs: { cronSpecsDir: cronDir },
		});

		await runner.tick();
		await runner.dispose();

		const request = requireValue(calls.startRequests[0]);
		expect(request.mode).toBe("yolo");
		expect(request.toolPolicies?.["*"]).toEqual({
			enabled: false,
			autoApprove: true,
		});
		expect(request.toolPolicies?.[DefaultToolNames.READ_FILES]).toEqual({
			enabled: true,
			autoApprove: true,
		});
		expect(request.toolPolicies?.[DefaultToolNames.ASK]).toEqual({
			enabled: false,
			autoApprove: true,
		});
		expect(request.toolPolicies?.[DefaultToolNames.SUBMIT_AND_EXIT]).toEqual({
			enabled: true,
			autoApprove: true,
		});
	});

	it.each([
		"act",
		"plan",
		"yolo",
	] as const)("preserves an explicit %s mode for scheduled runs", async (mode) => {
		const { handlers, calls } = fakeHandlers();
		const upserted = store.upsertSpec({
			externalId: `explicit-${mode}`,
			sourcePath: `explicit-${mode}.md`,
			triggerKind: "one_off",
			sourceHash: `h-${mode}`,
			parseStatus: "valid",
			spec: {
				triggerKind: "one_off",
				id: `explicit-${mode}`,
				title: `Explicit ${mode}`,
				prompt: "Do it",
				workspaceRoot,
				enabled: true,
				mode,
			},
		});
		store.updateSpecNextRunAt(
			upserted.record.specId,
			new Date(Date.now() - 1_000).toISOString(),
		);
		const runner = new CronRunner({
			store,
			materializer,
			runtimeHandlers: handlers,
			workspaceRoot,
			specs: { cronSpecsDir: cronDir },
		});

		await runner.tick();
		await runner.dispose();

		const request = requireValue(calls.startRequests[0]);
		expect(request.mode).toBe(mode);
		expect(request.toolPolicies?.[DefaultToolNames.ASK]).toEqual({
			enabled: false,
			autoApprove: true,
		});
		expect(request.toolPolicies?.[DefaultToolNames.SUBMIT_AND_EXIT]).toEqual(
			mode === "yolo" ? { enabled: true, autoApprove: true } : undefined,
		);
	});

	it("marks runs failed when the runtime throws", async () => {
		const capture = vi.fn();
		const handlers: HubScheduleRuntimeHandlers = {
			async startSession() {
				throw new Error("no runtime");
			},
			async sendSession() {
				throw new Error("unreachable");
			},
			async abortSession() {
				return { applied: true };
			},
			async stopSession() {
				return { applied: true };
			},
		};
		const upserted = store.upsertSpec({
			externalId: "cleanup",
			sourcePath: "cleanup.md",
			triggerKind: "one_off",
			sourceHash: "h",
			parseStatus: "valid",
			spec: {
				triggerKind: "one_off",
				id: "cleanup",
				title: "Clean",
				prompt: "Do it",
				workspaceRoot,
				enabled: true,
			},
		});
		const runner = new CronRunner({
			store,
			materializer,
			runtimeHandlers: handlers,
			telemetry: { capture } as unknown as ITelemetryService,
			workspaceRoot,
			specs: { cronSpecsDir: cronDir },
		});
		await runner.tick();
		await runner.dispose();

		const run = requireValue(
			store.listRuns({ specId: upserted.record.specId })[0],
		);
		expect(capture).toHaveBeenLastCalledWith({
			event: "schedule.run_finished",
			properties: {
				triggerKind: "one_off",
				attemptCount: 1,
				startDelayMs: expect.any(Number),
				durationMs: expect.any(Number),
				outcome: "failed",
			},
		});
		expect(run.status).toBe("failed");
		expect(run.error).toMatch(/no runtime/);
	});

	it("executes queued event runs with trigger context and report provenance", async () => {
		const { handlers, calls } = fakeHandlers();
		const upserted = store.upsertSpec({
			externalId: "pr-review",
			sourcePath: "events/pr-review.event.md",
			triggerKind: "event",
			sourceHash: "h",
			parseStatus: "valid",
			spec: {
				triggerKind: "event",
				id: "pr-review",
				title: "PR Review",
				prompt: "Review the opened pull request",
				workspaceRoot,
				enabled: true,
				event: "github.pull_request.opened",
				filters: { repository: "acme/api" },
			},
		});
		store.insertEventLog({
			eventId: "evt_1",
			eventType: "github.pull_request.opened",
			source: "github",
			subject: "acme/api#12",
			occurredAt: "2026-04-23T10:00:00.000Z",
			dedupeKey: "pr:12",
			attributes: { repository: "acme/api" },
		});
		store.enqueueRun({
			specId: upserted.record.specId,
			specRevision: upserted.record.revision,
			triggerKind: "event",
			triggerEventId: "evt_1",
		});

		const runner = new CronRunner({
			store,
			materializer,
			runtimeHandlers: handlers,
			workspaceRoot,
			specs: { cronSpecsDir: cronDir },
		});
		await runner.tick();
		await runner.dispose();

		expect(calls.send).toBe(1);
		expect(calls.prompts[0]).toContain("Trigger event:");
		expect(calls.prompts[0]).toContain("github.pull_request.opened");
		const run = requireValue(
			store.listRuns({ specId: upserted.record.specId })[0],
		);
		expect(run.status).toBe("done");
		const reportPath = requireValue(run.reportPath);
		const report = readFileSync(reportPath, "utf8");
		expect(report).toContain("triggerEventType: github.pull_request.opened");
		expect(report).toContain("## Trigger Event");
	});

	it("leaves excess work unclaimed when database capacity is full", async () => {
		const { handlers } = fakeHandlers();
		const upserted = store.upsertSpec({
			externalId: "nightly",
			sourcePath: "nightly.cron.md",
			triggerKind: "schedule",
			sourceHash: "h",
			parseStatus: "valid",
			spec: {
				triggerKind: "schedule",
				id: "nightly",
				title: "Nightly",
				prompt: "Do it",
				workspaceRoot,
				enabled: true,
				schedule: "0 2 * * *",
			},
		});
		store.enqueueRun({
			specId: upserted.record.specId,
			specRevision: upserted.record.revision,
			triggerKind: "schedule",
		});
		const blocked = store.enqueueRun({
			specId: upserted.record.specId,
			specRevision: upserted.record.revision,
			triggerKind: "schedule",
		});
		const runner = new CronRunner({
			store,
			materializer,
			runtimeHandlers: handlers,
			workspaceRoot,
			specs: { cronSpecsDir: cronDir },
			globalMaxConcurrency: 1,
		});
		await runner.tick();
		await runner.dispose();

		const requeued = store.getRun(blocked.runId);
		expect(requeued?.status).toBe("queued");
		expect(requeued?.attemptCount).toBe(0);
		expect(requeued?.error).toBeUndefined();
	});

	function queuedSchedule(name: string, timeoutSeconds?: number) {
		const spec = store.createHubSchedule({
			name,
			prompt: name,
			cronPattern: "0 0 * * *",
			workspaceRoot,
			timeoutSeconds,
			maxParallel: 1,
		});
		const enqueue = (offset = 0) =>
			store.enqueueRun({
				specId: spec.specId,
				specRevision: spec.revision,
				triggerKind: "manual",
				scheduledFor: new Date(Date.now() + offset).toISOString(),
			});
		return { spec, enqueue, run: enqueue() };
	}
	function testRunner(handlers: HubScheduleRuntimeHandlers) {
		return new CronRunner({
			store,
			materializer,
			runtimeHandlers: handlers,
			workspaceRoot,
			specs: { cronSpecsDir: cronDir },
		});
	}
	function gate() {
		let resolve!: () => void;
		const promise = new Promise<void>((done) => {
			resolve = done;
		});
		return { promise, resolve };
	}

	it("cancels and drains running work on stop without replaying it", async () => {
		const { handlers, calls } = fakeHandlers();
		const pending = gate();
		handlers.sendSession = async () => {
			calls.send++;
			await pending.promise;
			return { result: { text: "late" } };
		};
		const abort = vi.spyOn(handlers, "abortSession");
		const { run } = queuedSchedule("shutdown");
		const runner = testRunner(handlers);
		const tick = runner.tick();
		await vi.waitFor(() => expect(calls.send).toBe(1));
		await runner.stop();
		expect(abort).toHaveBeenCalledOnce();
		expect(runner.getActiveRuns()).toHaveLength(0);
		expect(store.getRun(run.runId)?.status).toBe("cancelled");
		expect(
			store.claimDueRuns({ nowIso: new Date().toISOString(), leaseMs: 30000 }),
		).toHaveLength(0);
		pending.resolve();
		await tick;
		await runner.dispose();
	});

	it.each([
		"stop",
		"timeout",
	])("does not send a turn after %s during startup", async (reason) => {
		const { handlers, calls } = fakeHandlers();
		const pending = gate();
		handlers.startSession = async () => {
			calls.start++;
			await pending.promise;
			return { sessionId: "late" };
		};
		const abort = vi.spyOn(handlers, "abortSession");
		const { run } = queuedSchedule(
			"late-start",
			reason === "timeout" ? 1 : undefined,
		);
		const runner = testRunner(handlers);
		const tick = runner.tick();
		await vi.waitFor(() => expect(calls.start).toBe(1));
		if (reason === "stop") await runner.stop();
		await tick;
		expect(store.getRun(run.runId)?.status).toBe(
			reason === "stop" ? "cancelled" : "failed",
		);
		expect(runner.getActiveRuns()).toHaveLength(0);
		await runner.dispose();
		pending.resolve();
		await vi.waitFor(() => expect(abort).toHaveBeenCalledWith("late"));
		expect(calls.send).toBe(0);
		expect(store.getRun(run.runId)?.sessionId).toBeUndefined();
	});

	it("checks elapsed deadlines before dispatch when startup resumes before the timer", async () => {
		const { handlers, calls } = fakeHandlers();
		const pending = gate();
		handlers.startSession = async () => {
			calls.start++;
			await pending.promise;
			return { sessionId: "after-sleep" };
		};
		const { run } = queuedSchedule("overdue-start", 1);
		const runner = testRunner(handlers);
		const tick = runner.tick();
		await vi.waitFor(() => expect(calls.start).toBe(1));
		const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 2000);
		try {
			pending.resolve();
			await tick;
			expect(store.getRun(run.runId)?.status).toBe("failed");
			expect(calls.send).toBe(0);
		} finally {
			now.mockRestore();
			await runner.dispose();
		}
	});

	it.each([
		false,
		true,
	])("persists the execution outcome when report writing fails (turn fails: %s)", async (fails) => {
		const { handlers } = fakeHandlers();
		if (fails)
			handlers.sendSession = async () => {
				throw new Error("provider failed");
			};
		const { run } = queuedSchedule("report");
		mkdirSync(cronDir, { recursive: true });
		writeFileSync(join(cronDir, "reports"), "not a directory");
		const runner = testRunner(handlers);
		await runner.tick();
		expect(store.getRun(run.runId)?.status).toBe(fails ? "failed" : "done");
		expect(store.getRun(run.runId)?.claimToken).toBeUndefined();
		expect(runner.getActiveRuns()).toHaveLength(0);
		expect(
			store.claimDueRuns({
				nowIso: new Date(Date.now() + 120000).toISOString(),
				leaseMs: 30000,
			}),
		).toHaveLength(0);
		await runner.dispose();
	});

	it("skips more than a claim batch of blocked siblings to dispatch another schedule", async () => {
		const { handlers, calls } = fakeHandlers();
		const pending = gate();
		const send = handlers.sendSession;
		handlers.sendSession = async (id, req) => {
			if (req.prompt === "busy") await pending.promise;
			return send(id, req);
		};
		const busy = queuedSchedule("busy");
		const runner = testRunner(handlers);
		const tick = runner.tick();
		await vi.waitFor(() => expect(calls.start).toBe(1));
		for (let i = 0; i < 30; i++) busy.enqueue(-1000);
		const other = queuedSchedule("other");
		await runner.tick();
		expect(store.getRun(other.run.runId)?.status).toBe("done");
		expect(
			store
				.listRuns({ specId: busy.spec.specId, status: "queued", limit: 100 })
				.every((run) => run.attemptCount === 0),
		).toBe(true);
		pending.resolve();
		await tick;
		await runner.dispose();
	});

	it("enforces schedule capacity across database connections", async () => {
		const { handlers, calls } = fakeHandlers();
		const pending = gate();
		handlers.sendSession = async () => {
			await pending.promise;
			return { result: { text: "done" } };
		};
		const busy = queuedSchedule("shared");
		const first = testRunner(handlers);
		const secondStore = new SqliteCronStore({ dbPath: join(dir, "cron.db") });
		const second = new CronRunner({
			store: secondStore,
			materializer: new CronMaterializer({ store: secondStore }),
			runtimeHandlers: handlers,
			workspaceRoot,
			specs: { cronSpecsDir: cronDir },
		});
		const tick = first.tick();
		await vi.waitFor(() => expect(calls.start).toBe(1));
		const sibling = busy.enqueue();
		await second.tick();
		expect(calls.start).toBe(1);
		expect(store.getRun(sibling.runId)?.status).toBe("queued");
		pending.resolve();
		await tick;
		await second.tick();
		expect(calls.start).toBe(2);
		await first.dispose();
		await second.dispose();
		secondStore.close();
	});

	it("enforces global capacity across database connections", () => {
		queuedSchedule("first");
		queuedSchedule("second");
		const peer = new SqliteCronStore({ dbPath: join(dir, "cron.db") });
		try {
			const options = {
				nowIso: new Date().toISOString(),
				leaseMs: 30000,
				maxConcurrency: 1,
			};
			const first = store.claimDueRuns(options);
			expect(first).toHaveLength(1);
			expect(peer.claimDueRuns(options)).toHaveLength(0);
			const claim = requireValue(first[0]);
			store.completeRun(claim.run.runId, {
				status: "done",
				claimToken: claim.claimToken,
			});
			expect(peer.claimDueRuns(options)).toHaveLength(1);
		} finally {
			peer.close();
		}
	});

	it("bounds shutdown even if runtime cleanup never settles", async () => {
		const { handlers, calls } = fakeHandlers();
		const pending = gate();
		handlers.sendSession = async () => {
			calls.send++;
			await pending.promise;
			return { result: { text: "late" } };
		};
		handlers.abortSession = async () => {
			await pending.promise;
			return { applied: true };
		};
		handlers.stopSession = async () => {
			await pending.promise;
			return { applied: true };
		};
		const { run } = queuedSchedule("hung-cleanup");
		const runner = testRunner(handlers);
		const tick = runner.tick();
		await vi.waitFor(() => expect(calls.send).toBe(1));
		vi.useFakeTimers();
		try {
			const stop = runner.stop();
			await vi.advanceTimersByTimeAsync(10001);
			await stop;
			expect(runner.getActiveRuns()).toHaveLength(0);
			expect(store.getRun(run.runId)?.status).toBe("cancelled");
		} finally {
			vi.useRealTimers();
			pending.resolve();
			await tick;
			await runner.dispose();
		}
	});

	it("aborts a stale worker without overwriting its replacement claim", async () => {
		const { handlers, calls } = fakeHandlers();
		const pending = gate();
		handlers.sendSession = async () => {
			calls.send++;
			await pending.promise;
			return { result: { text: "late" } };
		};
		const abort = vi.spyOn(handlers, "abortSession");
		const { run } = queuedSchedule("lease-loss");
		const runner = testRunner(handlers);
		const tick = runner.tick();
		await vi.waitFor(() => expect(calls.send).toBe(1));
		const old = requireValue(store.getRun(run.runId));
		store.renewClaim(
			run.runId,
			requireValue(old.claimToken),
			new Date(0).toISOString(),
		);
		const replacement = requireValue(
			store.claimDueRuns({
				nowIso: new Date().toISOString(),
				leaseMs: 30000,
			})[0],
		);
		await runner.tick();
		await tick;
		expect(abort).toHaveBeenCalledOnce();
		expect(store.getRun(run.runId)?.claimToken).toBe(replacement.claimToken);
		expect(store.getRun(run.runId)?.reportPath).toBeUndefined();
		expect(
			store.attachSessionIdToRun(
				run.runId,
				"stale",
				requireValue(old.claimToken),
			),
		).toBe(false);
		pending.resolve();
		await runner.dispose();
	});
	it("stamps schedule provenance and a stable run number onto each session", async () => {
		const { handlers, calls } = fakeHandlers();
		const upserted = store.upsertSpec({
			externalId: "sched_nightly",
			sourcePath: "nightly.cron.md",
			triggerKind: "schedule",
			sourceHash: "h",
			parseStatus: "valid",
			spec: {
				triggerKind: "schedule",
				id: "sched_nightly",
				title: "Nightly report",
				prompt: "Do it",
				workspaceRoot,
				enabled: true,
				schedule: "0 2 * * *",
				modelSelection: { providerId: "p", modelId: "m" },
			},
		});
		const enqueue = () =>
			store.enqueueRun({
				specId: upserted.record.specId,
				specRevision: upserted.record.revision,
				triggerKind: "schedule",
				scheduledFor: new Date(Date.now() - 1_000).toISOString(),
			});
		const runner = new CronRunner({
			store,
			materializer,
			runtimeHandlers: handlers,
			workspaceRoot,
			specs: { cronSpecsDir: cronDir },
			pollIntervalMs: 10_000,
		});
		const first = enqueue();
		await runner.tick();
		const second = enqueue();
		await runner.tick();
		await runner.dispose();

		expect(calls.start).toBe(2);
		expect(calls.startOptions[0]?.sessionMetadata).toEqual({
			scheduleId: "sched_nightly",
			scheduleName: "Nightly report",
			scheduleExecutionId: first.runId,
			scheduleRunNumber: 1,
		});
		expect(calls.startOptions[1]?.sessionMetadata).toEqual({
			scheduleId: "sched_nightly",
			scheduleName: "Nightly report",
			scheduleExecutionId: second.runId,
			scheduleRunNumber: 2,
		});
	});
});
