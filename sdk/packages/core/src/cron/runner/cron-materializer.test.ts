import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteCronStore } from "../store/sqlite-cron-store";
import { CronMaterializer } from "./cron-materializer";

describe("CronMaterializer", () => {
	let dir: string;
	let store: SqliteCronStore;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "cline-materializer-"));
		store = new SqliteCronStore({ dbPath: join(dir, "cron.db") });
	});
	afterEach(() => {
		store.close();
		rmSync(dir, { recursive: true, force: true });
	});

	function seedOneOff() {
		return store.upsertSpec({
			externalId: "cleanup",
			sourcePath: "cleanup.md",
			triggerKind: "one_off",
			sourceHash: "h",
			parseStatus: "valid",
			spec: {
				triggerKind: "one_off",
				id: "cleanup",
				title: "Clean",
				prompt: "p",
				workspaceRoot: "/ws",
				enabled: true,
			},
		}).record;
	}

	it("queues exactly one run per one-off spec revision", () => {
		seedOneOff();
		const m = new CronMaterializer({ store });
		expect(m.materializeAll().oneOffQueued).toBe(1);
		expect(m.materializeAll().oneOffQueued).toBe(0);
	});

	it("queues a new run when the revision bumps", () => {
		const spec = seedOneOff();
		const m = new CronMaterializer({ store });
		m.materializeAll();
		store.upsertSpec({
			externalId: "cleanup",
			sourcePath: "cleanup.md",
			triggerKind: "one_off",
			sourceHash: "h2",
			parseStatus: "valid",
			spec: {
				triggerKind: "one_off",
				id: "cleanup",
				title: "Clean",
				prompt: "new prompt",
				workspaceRoot: "/ws",
				enabled: true,
			},
		});
		const updated = store.getSpec(spec.specId)!;
		expect(updated.revision).toBe(2);
		expect(m.materializeAll().oneOffQueued).toBe(1);
		const runs = store.listRuns({ specId: spec.specId });
		expect(runs.length).toBe(2);
	});

	it("does not requeue a failed one-off run for the same revision", () => {
		const spec = seedOneOff();
		const m = new CronMaterializer({ store });
		expect(m.materializeAll().oneOffQueued).toBe(1);
		const run = store.listRuns({ specId: spec.specId })[0]!;
		store.completeRun(run.runId, { status: "failed", error: "boom" });

		expect(m.materializeAll().oneOffQueued).toBe(0);
		const runs = store.listRuns({ specId: spec.specId });
		expect(runs).toHaveLength(1);
		expect(runs[0]?.status).toBe("failed");
	});

	it("catches up one overdue schedule run and advances next_run_at", () => {
		const past = new Date(Date.now() - 60_000).toISOString();
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
				prompt: "p",
				workspaceRoot: "/ws",
				enabled: true,
				schedule: "* * * * *",
			},
		});
		// Force an overdue next_run_at.
		store.updateSpecNextRunAt(upserted.record.specId, past);

		const m = new CronMaterializer({ store });
		expect(m.materializeAll().scheduleQueued).toBe(1);
		expect(m.materializeAll().scheduleQueued).toBe(0);
		const after = store.getSpec(upserted.record.specId)!;
		expect(after.nextRunAt).toBeDefined();
		expect(new Date(after.nextRunAt!).getTime()).toBeGreaterThan(Date.now());
	});

	it("does not duplicate a due schedule run when called twice with a stale spec snapshot", () => {
		const nowMs = Date.parse("2026-04-23T10:00:00.000Z");
		const dueAt = new Date(nowMs - 60_000).toISOString();
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
				prompt: "p",
				workspaceRoot: "/ws",
				enabled: true,
				schedule: "* * * * *",
			},
		});
		store.updateSpecNextRunAt(upserted.record.specId, dueAt);
		const staleSpec = store.getSpec(upserted.record.specId)!;
		const m = new CronMaterializer({ store, now: () => nowMs });

		expect(m.materializeSchedule(staleSpec)).toBe(true);
		expect(m.materializeSchedule(staleSpec)).toBe(false);

		const runs = store.listRuns({ specId: upserted.record.specId });
		expect(runs).toHaveLength(1);
		expect(runs[0]?.scheduledFor).toBe(dueAt);
	});
});
