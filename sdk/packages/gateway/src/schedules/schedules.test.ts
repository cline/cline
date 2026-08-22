/**
 * Schedules (Gateway RFC, Phase 6): Gateway-owned triggers, durable
 * claims, retries, and reports. Automations create ordinary runs with
 * explicit automation provenance through the shared FIFO admission path.
 * Expired claims recover on the same job — adopting an already-admitted
 * run instead of creating a replacement session — and live foreign
 * claims are never stolen.
 */

import { createGatewayInstanceId } from "@cline/shared/gateway";
import { describe, expect, it } from "vitest";
import { openGatewayDatabase } from "../db";
import { ensureGatewayDataDir, resolveGatewayPaths } from "../paths";
import { GatewayRuntime } from "../runtime";
import { createGatewayStores } from "../stores";
import { ScriptedEnginePort, tempDataRoot, waitFor } from "../test-support";
import { Scheduler } from "./scheduler";

function createHarness(options: { autoComplete?: boolean } = {}) {
	const dataRoot = tempDataRoot();
	const paths = resolveGatewayPaths({ dataRoot, namespace: "default" });
	ensureGatewayDataDir(paths);
	const database = openGatewayDatabase(paths.databaseFile);
	const instanceId = createGatewayInstanceId();
	const stores = createGatewayStores(database, instanceId);
	const engine = new ScriptedEnginePort();
	if (options.autoComplete ?? true) {
		engine.autoOutcome = () => ({ outputText: "automated" });
	}
	let now = 1_000_000;
	const clock = { now: () => now };
	const runtime = new GatewayRuntime({
		database,
		stores,
		paths,
		instanceId,
		engine,
		clock,
	});
	runtime.bootstrap();
	const scheduler = new Scheduler({
		database,
		stores,
		admitAutomationRun: (schedule) => runtime.startAutomationRun(schedule),
		instanceId,
		clock: () => now,
		claimTtlMs: 10_000,
		tickIntervalMs: 0,
	});
	const botId = runtime.defaultBotId;
	if (!botId) {
		throw new Error("bootstrap failed");
	}
	return {
		stores,
		runtime,
		scheduler,
		engine,
		botId,
		instanceId,
		advance: (ms: number) => {
			now += ms;
			return now;
		},
		now: () => now,
	};
}

describe("schedule triggers", () => {
	it("updates, pauses, manually triggers, and deletes Gateway-owned schedules", async () => {
		const { runtime, scheduler, stores, botId, advance, now } = createHarness();
		const created = runtime.createSchedule("desktop", {
			botId,
			name: "daily review",
			prompt: "review the workspace",
			at: now() + 60_000,
			workspaceRoot: "/workspace/project",
			modelSelection: { providerId: "cline", modelId: "test-model" },
			mode: "yolo",
			maxParallel: 1,
			tags: ["review"],
		});
		const updated = runtime.updateSchedule("desktop", {
			scheduleId: created.scheduleId,
			expectedRevision: created.revision,
			name: "weekday review",
			prompt: "review and summarize",
			cronPattern: "15 9 * * MON-FRI",
			metadata: { owner: "desktop" },
		});
		expect(updated).toMatchObject({
			name: "weekday review",
			prompt: "review and summarize",
			cronPattern: "15 9 * * MON-FRI",
			intervalMs: undefined,
			at: undefined,
			metadata: { owner: "desktop" },
			revision: 1,
		});
		expect(() =>
			runtime.updateSchedule("desktop", {
				scheduleId: created.scheduleId,
				expectedRevision: 0,
				name: "stale",
			}),
		).toThrow("Schedule revision changed");

		const disabled = runtime.setScheduleEnabled(
			"desktop",
			created.scheduleId,
			false,
		);
		expect(disabled.enabled).toBe(false);
		advance(8 * 24 * 60 * 60 * 1_000);
		expect(scheduler.tick().materialized).toBe(0);

		const manual = runtime.triggerSchedule("desktop", created.scheduleId);
		expect(manual.job.state).toBe("pending");
		expect(scheduler.tick().admitted).toBe(1);
		const admitted = stores.scheduleJobs.get(manual.job.jobId);
		expect(admitted?.runId).toBeDefined();
		const admittedRunId = admitted?.runId;
		if (admittedRunId) {
			await waitFor(
				() => stores.runs.get(admittedRunId)?.state === "completed",
			);
		}

		expect(runtime.deleteSchedule("desktop", created.scheduleId)).toEqual({
			deleted: true,
		});
		expect(stores.schedules.get(created.scheduleId)).toBeUndefined();
		expect(stores.scheduleJobs.report(created.scheduleId)).toEqual([]);
		expect(runtime.deleteSchedule("desktop", created.scheduleId)).toEqual({
			deleted: false,
		});
	});

	it("a due schedule creates an ordinary run with automation provenance", async () => {
		const { runtime, scheduler, stores, botId, advance } = createHarness();
		const schedule = runtime.createSchedule("test", {
			botId,
			name: "daily-report",
			prompt: "write the report",
			intervalMs: 60_000,
		});
		// Not due yet.
		expect(scheduler.tick().materialized).toBe(0);
		advance(61_000);
		const report = scheduler.tick();
		expect(report.materialized).toBe(1);
		expect(report.claimed).toBe(1);
		expect(report.admitted).toBe(1);

		const jobs = stores.scheduleJobs.report(schedule.scheduleId);
		expect(jobs).toHaveLength(1);
		const runId = jobs[0].runId;
		if (!runId) {
			throw new Error("job has no run");
		}
		const run = stores.runs.get(runId);
		expect(run?.input).toBe("write the report");
		const provenance = runtime.runProvenance(runId);
		expect(provenance?.mode).toBe("automation");
		expect(provenance?.scheduleId).toBe(schedule.scheduleId);

		// The run completes (scripted engine) and the job report settles.
		await waitFor(() => stores.runs.get(runId)?.state === "completed");
		const settled = scheduler.tick();
		expect(settled.settled).toBe(1);
		expect(stores.scheduleJobs.report(schedule.scheduleId)[0].state).toBe(
			"completed",
		);
	});

	it("automation runs share the session FIFO with interactive runs", async () => {
		const { runtime, scheduler, stores, engine, botId, advance } =
			createHarness({ autoComplete: false });
		// An interactive run is active in the bot's canonical session.
		const interactive = runtime.startRun("cli_test", {
			botId,
			prompt: "interactive first",
		});
		runtime.createSchedule("test", {
			botId,
			name: "later",
			prompt: "automation second",
			intervalMs: 1_000,
		});
		advance(2_000);
		scheduler.tick();
		const runs = runtime.listRuns({});
		const automationRun = runs.find((run) => run.input === "automation second");
		if (!automationRun) {
			throw new Error("automation run missing");
		}
		// Same session, queued behind the active interactive run: FIFO.
		expect(automationRun.sessionId).toBe(
			stores.runs.get(interactive.runId)?.sessionId,
		);
		expect(automationRun.state).toBe("queued");
		engine.handles[0].settle({ outputText: "done" });
		await waitFor(
			() => stores.runs.get(automationRun.runId)?.state === "running",
		);
		engine.handles[1].settle({ outputText: "done too" });
		await waitFor(
			() => stores.runs.get(automationRun.runId)?.state === "completed",
		);
	});

	it("one-shot schedules fire exactly once", () => {
		const { runtime, scheduler, stores, botId, advance, now } = createHarness();
		const schedule = runtime.createSchedule("test", {
			botId,
			name: "once",
			prompt: "one time",
			at: now() + 500,
		});
		advance(1_000);
		expect(scheduler.tick().materialized).toBe(1);
		expect(
			stores.schedules.get(schedule.scheduleId)?.nextDueAt,
		).toBeUndefined();
		advance(10_000);
		expect(scheduler.tick().materialized).toBe(0);
		expect(stores.scheduleJobs.report(schedule.scheduleId)).toHaveLength(1);
	});

	it("missed recurring firings coalesce into one job", () => {
		const { runtime, scheduler, stores, botId, advance, now } = createHarness();
		const schedule = runtime.createSchedule("test", {
			botId,
			name: "frequent",
			prompt: "beat",
			intervalMs: 1_000,
		});
		// The gateway was "down" for 10 intervals.
		advance(10_500);
		scheduler.tick();
		expect(stores.scheduleJobs.report(schedule.scheduleId)).toHaveLength(1);
		// The next due time is in the future, not in the missed past.
		const next = stores.schedules.get(schedule.scheduleId)?.nextDueAt;
		expect(next).toBeGreaterThan(now());
	});
});

describe("durable claims", () => {
	it("never claims a firing held live by another instance", () => {
		const { runtime, scheduler, stores, botId, advance, now } = createHarness();
		const schedule = runtime.createSchedule("test", {
			botId,
			name: "contended",
			prompt: "work",
			intervalMs: 1_000,
		});
		advance(2_000);
		// Materialize without claiming, then have a foreign live instance
		// claim the job.
		stores.scheduleJobs.ensureJob(
			schedule.scheduleId,
			stores.schedules.get(schedule.scheduleId)?.nextDueAt ?? now(),
			now(),
		);
		const job = stores.scheduleJobs.report(schedule.scheduleId)[0];
		expect(
			stores.scheduleJobs.claim(
				job.jobId,
				createGatewayInstanceId(),
				now(),
				60_000,
			),
		).toBe(true);
		const report = scheduler.tick();
		expect(report.claimed).toBe(0);
		expect(report.admitted).toBe(0);
	});

	it("recovers an expired claim by adopting its run — no replacement session", async () => {
		const { runtime, scheduler, stores, engine, botId, advance, now } =
			createHarness({ autoComplete: false });
		const schedule = runtime.createSchedule("test", {
			botId,
			name: "recoverable",
			prompt: "long job",
			// Long interval: the next firing stays far outside the test window.
			intervalMs: 3_600_000,
		});
		advance(3_600_001);
		scheduler.tick(); // materialize + claim + admit (run now running)
		const job = stores.scheduleJobs.report(schedule.scheduleId)[0];
		const runId = job.runId;
		if (!runId) {
			throw new Error("no run admitted");
		}
		const sessionsBefore = stores.sessions.list().length;
		const runsBefore = runtime.listRuns({}).length;

		// The claiming worker "dies": hand the claim to a dead instance and
		// expire it.
		stores.scheduleJobs.claim(job.jobId, "gwi_deadinstance00", now() - 1, 0);

		advance(20_000); // past the claim TTL
		const recovery = scheduler.tick();
		expect(recovery.adopted).toBe(1);
		expect(recovery.admitted, "no second run is admitted").toBe(0);
		// No replacement session, no duplicate run.
		expect(stores.sessions.list().length).toBe(sessionsBefore);
		expect(runtime.listRuns({}).length).toBe(runsBefore);
		// The recovered claim belongs to this instance and watches the run.
		const reclaimed = stores.scheduleJobs.report(schedule.scheduleId)[0];
		expect(reclaimed.state).toBe("claimed");
		expect(reclaimed.runId).toBe(runId);

		engine.handles[0].settle({ outputText: "finally" });
		await waitFor(() => stores.runs.get(runId)?.state === "completed");
		scheduler.tick();
		expect(stores.scheduleJobs.report(schedule.scheduleId)[0].state).toBe(
			"completed",
		);
	});
});

describe("retries and reports", () => {
	it("retries a failed firing up to maxAttempts with fresh runs", async () => {
		const { runtime, scheduler, stores, engine, botId, advance } =
			createHarness({ autoComplete: false });
		// The first admitted run fails; the retried (fresh) run succeeds.
		let engineCalls = 0;
		engine.autoOutcome = () => {
			engineCalls += 1;
			return engineCalls === 1
				? {
						status: "failed",
						outputText: "",
						error: { name: "Boom", message: "first try failed" },
					}
				: { status: "completed", outputText: "second try" };
		};
		const schedule = runtime.createSchedule("test", {
			botId,
			name: "retryable",
			prompt: "try hard",
			maxAttempts: 2,
			intervalMs: 60_000,
		});
		advance(61_000);
		scheduler.tick();
		const firstJob = stores.scheduleJobs.report(schedule.scheduleId)[0];
		const firstRunId = firstJob.runId;
		if (!firstRunId) {
			throw new Error("no first run");
		}
		await waitFor(() => stores.runs.get(firstRunId)?.state === "failed");

		// Tick 1: the failed run returns the job for an explicit retry.
		const retryReport = scheduler.tick();
		expect(retryReport.retried).toBe(1);
		// Tick 2: the pending job is re-claimed and admits a fresh run.
		const secondReport = scheduler.tick();
		expect(secondReport.admitted).toBe(1);
		const retriedJob = stores.scheduleJobs.report(schedule.scheduleId)[0];
		expect(retriedJob.runId).not.toBe(firstRunId);
		expect(retriedJob.attempts).toBe(2);
		const secondRunId = retriedJob.runId;
		if (!secondRunId) {
			throw new Error("no second run");
		}
		await waitFor(() => stores.runs.get(secondRunId)?.state === "completed");
		scheduler.tick();
		const finalJob = stores.scheduleJobs.report(schedule.scheduleId)[0];
		expect(finalJob.state).toBe("completed");
		expect(finalJob.lastError).toBeUndefined();
	});

	it("settles as failed with the error once attempts are exhausted", async () => {
		const { runtime, scheduler, stores, engine, botId, advance } =
			createHarness({ autoComplete: false });
		engine.autoOutcome = () => ({
			status: "failed",
			error: { name: "Boom", message: "always fails" },
		});
		const schedule = runtime.createSchedule("test", {
			botId,
			name: "doomed",
			prompt: "fail",
			maxAttempts: 1,
			intervalMs: 60_000,
		});
		advance(61_000);
		scheduler.tick();
		const job = stores.scheduleJobs.report(schedule.scheduleId)[0];
		if (!job.runId) {
			throw new Error("no run");
		}
		const runId = job.runId;
		await waitFor(() => stores.runs.get(runId)?.state === "failed");
		const report = scheduler.tick();
		expect(report.settled).toBe(1);
		const settled = stores.scheduleJobs.report(schedule.scheduleId)[0];
		expect(settled.state).toBe("failed");
		expect(settled.lastError).toBe("always fails");
	});
});
