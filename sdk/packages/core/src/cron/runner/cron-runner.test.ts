import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HubScheduleRuntimeHandlers } from "../service/schedule-service";
import { SqliteCronStore } from "../store/sqlite-cron-store";
import { CronMaterializer } from "./cron-materializer";
import { CronRunner } from "./cron-runner";

function fakeHandlers(): {
	handlers: HubScheduleRuntimeHandlers;
	calls: { start: number; send: number; stop: number; prompts: string[] };
} {
	const calls = { start: 0, send: 0, stop: 0, prompts: [] as string[] };
	const handlers: HubScheduleRuntimeHandlers = {
		async startSession(_req) {
			calls.start += 1;
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
		const run = store.listRuns({ specId: upserted.record.specId })[0]!;
		expect(run.status).toBe("done");
		expect(run.reportPath).toBeDefined();
		const report = readFileSync(run.reportPath!, "utf8");
		expect(report).toContain("triggerEventType: github.pull_request.opened");
		expect(report).toContain("## Trigger Event");
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
