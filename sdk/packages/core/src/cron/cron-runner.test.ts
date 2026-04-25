import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CronMaterializer } from "./cron-materializer";
import { CronRunner } from "./cron-runner";
import type { HubScheduleRuntimeHandlers } from "./schedule-service";
import { SqliteCronStore } from "./sqlite-cron-store";

function fakeHandlers(): {
	handlers: HubScheduleRuntimeHandlers;
	calls: { start: number; send: number; stop: number };
} {
	const calls = { start: 0, send: 0, stop: 0 };
	const handlers: HubScheduleRuntimeHandlers = {
		async startSession(_req) {
			calls.start += 1;
			return { sessionId: `sess_${calls.start}` };
		},
		async sendSession(_sessionId, _req) {
			calls.send += 1;
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

	it("executes a queued one-off run end-to-end and writes a report", async () => {
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
		const runner = new CronRunner({
			store,
			materializer,
			runtimeHandlers: handlers,
			workspaceRoot,
			specs: { cronSpecsDir: cronDir },
			pollIntervalMs: 10_000,
		});
		await runner.tick();
		await runner.dispose();

		expect(calls.start).toBe(1);
		expect(calls.send).toBe(1);
		expect(calls.stop).toBe(1);

		const run = store.listRuns({ specId: upserted.record.specId })[0]!;
		expect(run.status).toBe("done");
		expect(run.reportPath).toBeDefined();
		expect(existsSync(run.reportPath!)).toBe(true);
	});

	it("marks runs failed when the runtime throws", async () => {
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
			workspaceRoot,
			specs: { cronSpecsDir: cronDir },
		});
		await runner.tick();
		await runner.dispose();

		const run = store.listRuns({ specId: upserted.record.specId })[0]!;
		expect(run.status).toBe("failed");
		expect(run.error).toMatch(/no runtime/);
	});

	it("requeues runs that lose the limiter race instead of failing them", async () => {
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
		expect(requeued?.attemptCount).toBe(1);
		expect(requeued?.error).toBe("concurrency limit reached");
	});

	it("requeues active runs on stop and allows them to be reclaimed", async () => {
		let aborted = 0;
		const handlers: HubScheduleRuntimeHandlers = {
			async startSession() {
				return { sessionId: "unused" };
			},
			async sendSession() {
				return { result: { text: "unused" } };
			},
			async abortSession() {
				aborted += 1;
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
			workspaceRoot,
			specs: { cronSpecsDir: cronDir },
		});
		const run = store.enqueueRun({
			specId: upserted.record.specId,
			specRevision: upserted.record.revision,
			triggerKind: "one_off",
		});
		const [claim] = store.claimDueRuns({
			nowIso: new Date().toISOString(),
			leaseMs: 30_000,
		});
		expect(claim?.run.runId).toBe(run.runId);
		(runner as unknown as { started: boolean }).started = true;
		(
			runner as unknown as {
				activeRuns: Map<string, { claimToken: string; sessionId?: string }>;
			}
		).activeRuns.set(run.runId, {
			claimToken: claim?.claimToken,
			sessionId: "sess_stop",
		});
		await runner.stop();
		await runner.dispose();

		expect(aborted).toBe(1);
		const requeued = store.getRun(run.runId)!;
		expect(requeued.status).toBe("queued");
		expect(requeued.claimToken).toBeUndefined();
		expect(requeued.completedAt).toBeUndefined();

		const reclaimed = store.claimDueRuns({
			nowIso: new Date().toISOString(),
			leaseMs: 30_000,
		});
		expect(reclaimed).toHaveLength(1);
		expect(reclaimed[0]?.run.runId).toBe(run.runId);
	});
});
