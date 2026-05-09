import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CronOneOffSpec, CronScheduleSpec } from "@clinebot/shared";
import { loadSqliteDb } from "@clinebot/shared/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteCronStore } from "./sqlite-cron-store";

function tempDbPath(): { dir: string; path: string } {
	const dir = mkdtempSync(join(tmpdir(), "cline-cron-store-"));
	return { dir, path: join(dir, "cron.db") };
}

describe("SqliteCronStore", () => {
	let dir: string;
	let store: SqliteCronStore;

	beforeEach(() => {
		const tmp = tempDbPath();
		dir = tmp.dir;
		store = new SqliteCronStore({ dbPath: tmp.path });
	});

	afterEach(() => {
		store.close();
		rmSync(dir, { recursive: true, force: true });
	});

	const baseOneOff = (): CronOneOffSpec => ({
		triggerKind: "one_off",
		id: "cleanup",
		title: "Clean",
		prompt: "Remove stale files",
		workspaceRoot: "/ws",
		enabled: true,
	});

	it("creates a new spec row for a new source path", () => {
		const result = store.upsertSpec({
			externalId: "cleanup",
			sourcePath: "cleanup.md",
			triggerKind: "one_off",
			sourceHash: "hash1",
			parseStatus: "valid",
			spec: baseOneOff(),
		});
		expect(result.created).toBe(true);
		expect(result.revisionChanged).toBe(true);
		expect(result.record.revision).toBe(1);
		expect(result.record.enabled).toBe(true);
		expect(result.record.parseStatus).toBe("valid");
		expect(result.record.prompt).toBe("Remove stale files");
	});

	it("persists cron runtime controls", () => {
		const result = store.upsertSpec({
			externalId: "cleanup",
			sourcePath: "cleanup.md",
			triggerKind: "one_off",
			sourceHash: "hash1",
			parseStatus: "valid",
			spec: {
				...baseOneOff(),
				tools: ["run_commands", "read_files"],
				notesDirectory: "/notes",
				extensions: ["rules", "skills"],
				source: "automation",
			},
		});
		expect(result.record.tools).toEqual(["run_commands", "read_files"]);
		expect(result.record.notesDirectory).toBe("/notes");
		expect(result.record.extensions).toEqual(["rules", "skills"]);
		expect(result.record.source).toBe("automation");
	});

	it("does not bump revision on cosmetic-only re-upsert with same hash", () => {
		store.upsertSpec({
			externalId: "cleanup",
			sourcePath: "cleanup.md",
			triggerKind: "one_off",
			sourceHash: "hash1",
			parseStatus: "valid",
			spec: baseOneOff(),
		});
		const result = store.upsertSpec({
			externalId: "cleanup",
			sourcePath: "cleanup.md",
			triggerKind: "one_off",
			sourceHash: "hash1",
			parseStatus: "valid",
			spec: baseOneOff(),
		});
		expect(result.created).toBe(false);
		expect(result.revisionChanged).toBe(false);
		expect(result.record.revision).toBe(1);
	});

	it("bumps revision when the prompt changes", () => {
		store.upsertSpec({
			externalId: "cleanup",
			sourcePath: "cleanup.md",
			triggerKind: "one_off",
			sourceHash: "hash1",
			parseStatus: "valid",
			spec: baseOneOff(),
		});
		const result = store.upsertSpec({
			externalId: "cleanup",
			sourcePath: "cleanup.md",
			triggerKind: "one_off",
			sourceHash: "hash2",
			parseStatus: "valid",
			spec: { ...baseOneOff(), prompt: "New prompt" },
		});
		expect(result.revisionChanged).toBe(true);
		expect(result.record.revision).toBe(2);
	});

	it("records invalid parse status without a spec", () => {
		const result = store.upsertSpec({
			externalId: "bad.md",
			sourcePath: "bad.md",
			triggerKind: "one_off",
			sourceHash: "bad",
			parseStatus: "invalid",
			parseError: "boom",
		});
		expect(result.record.parseStatus).toBe("invalid");
		expect(result.record.enabled).toBe(false);
		expect(result.record.parseError).toBe("boom");
	});
});

describe("SqliteCronStore: schema migrations", () => {
	it("recreates the one-off run uniqueness index when its predicate changes", () => {
		const tmp = tempDbPath();
		const initialStore = new SqliteCronStore({ dbPath: tmp.path });
		initialStore.close();

		const db = loadSqliteDb(tmp.path);
		try {
			db.exec("DROP INDEX IF EXISTS cron_runs_one_off_active_idx;");
			db.exec(`CREATE UNIQUE INDEX cron_runs_one_off_active_idx
				ON cron_runs(spec_id, spec_revision)
				WHERE trigger_kind = 'one_off' AND status IN ('queued', 'running');`);
			const before = db
				.prepare(
					"SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'cron_runs_one_off_active_idx'",
				)
				.get();
			expect(String(before?.sql)).toContain("status IN");
		} finally {
			db.close?.();
		}

		const migratedStore = new SqliteCronStore({ dbPath: tmp.path });
		migratedStore.close();

		const migratedDb = loadSqliteDb(tmp.path);
		try {
			const after = migratedDb
				.prepare(
					"SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'cron_runs_one_off_active_idx'",
				)
				.get();
			const indexSql = String(after?.sql);
			expect(indexSql).toContain("WHERE trigger_kind = 'one_off'");
			expect(indexSql).not.toContain("status IN");
		} finally {
			migratedDb.close?.();
			rmSync(tmp.dir, { recursive: true, force: true });
		}
	});
});

describe("SqliteCronStore: runs", () => {
	let dir: string;
	let store: SqliteCronStore;

	beforeEach(() => {
		const tmp = tempDbPath();
		dir = tmp.dir;
		store = new SqliteCronStore({ dbPath: tmp.path });
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

	it("enqueues a queued one-off run and detects duplicates", () => {
		const spec = seedOneOff();
		expect(store.hasOneOffRunForRevision(spec.specId, 1)).toBe(false);
		const run = store.enqueueRun({
			specId: spec.specId,
			specRevision: 1,
			triggerKind: "one_off",
			scheduledFor: new Date().toISOString(),
		});
		expect(run.status).toBe("queued");
		expect(run.triggerKind).toBe("one_off");
		expect(store.hasOneOffRunForRevision(spec.specId, 1)).toBe(true);
	});

	it("treats failed one-off runs as satisfying the revision", () => {
		const spec = seedOneOff();
		const run = store.enqueueRun({
			specId: spec.specId,
			specRevision: 1,
			triggerKind: "one_off",
		});
		store.completeRun(run.runId, { status: "failed", error: "boom" });
		expect(store.hasOneOffRunForRevision(spec.specId, 1)).toBe(true);
	});

	it("claims due queued runs and completes them", () => {
		const spec = seedOneOff();
		store.enqueueRun({
			specId: spec.specId,
			specRevision: 1,
			triggerKind: "one_off",
			scheduledFor: new Date().toISOString(),
		});
		const claims = store.claimDueRuns({
			nowIso: new Date().toISOString(),
			leaseMs: 30_000,
		});
		expect(claims.length).toBe(1);
		expect(claims[0]?.run.status).toBe("running");
		const ok = store.completeRun(claims[0]?.run.runId, {
			status: "done",
			reportPath: "/tmp/report.md",
		});
		expect(ok).toBe(true);
		const run = store.getRun(claims[0]?.run.runId);
		expect(run?.status).toBe("done");
		expect(run?.reportPath).toBe("/tmp/report.md");
	});

	it("reclaims expired running leases", () => {
		const spec = seedOneOff();
		store.enqueueRun({
			specId: spec.specId,
			specRevision: 1,
			triggerKind: "one_off",
		});
		const firstClaims = store.claimDueRuns({
			nowIso: "2026-04-23T10:00:00.000Z",
			leaseMs: 1_000,
		});
		expect(firstClaims).toHaveLength(1);
		const reclaimed = store.claimDueRuns({
			nowIso: "2026-04-23T10:00:02.000Z",
			leaseMs: 1_000,
		});
		expect(reclaimed).toHaveLength(1);
		expect(reclaimed[0]?.run.runId).toBe(firstClaims[0]?.run.runId);
		expect(reclaimed[0]?.claimToken).not.toBe(firstClaims[0]?.claimToken);
		expect(reclaimed[0]?.run.attemptCount).toBe(2);
	});

	it("cancels queued runs when the spec is removed", () => {
		const spec = seedOneOff();
		store.enqueueRun({
			specId: spec.specId,
			specRevision: 1,
			triggerKind: "one_off",
		});
		expect(store.cancelQueuedRunsForSpec(spec.specId)).toBe(1);
		const runs = store.listRuns({ specId: spec.specId });
		expect(runs[0]?.status).toBe("cancelled");
	});

	it("requeues a claimed run when ownership matches", () => {
		const spec = seedOneOff();
		const queued = store.enqueueRun({
			specId: spec.specId,
			specRevision: 1,
			triggerKind: "one_off",
		});
		const [claim] = store.claimDueRuns({
			nowIso: "2026-04-23T10:00:00.000Z",
			leaseMs: 10_000,
		});
		expect(claim?.run.runId).toBe(queued.runId);
		expect(
			store.requeueRun({
				runId: claim?.run.runId,
				claimToken: claim?.claimToken,
				error: "retry later",
			}),
		).toBe(true);
		const run = store.getRun(queued.runId);
		expect(run?.status).toBe("queued");
		expect(run?.claimToken).toBeUndefined();
		expect(run?.startedAt).toBeUndefined();
		expect(run?.error).toBe("retry later");
	});
});

describe("SqliteCronStore: schedule spec fields", () => {
	let dir: string;
	let store: SqliteCronStore;

	beforeEach(() => {
		const tmp = tempDbPath();
		dir = tmp.dir;
		store = new SqliteCronStore({ dbPath: tmp.path });
	});
	afterEach(() => {
		store.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it("persists schedule_expr and timezone", () => {
		const spec: CronScheduleSpec = {
			triggerKind: "schedule",
			id: "nightly",
			title: "Nightly",
			prompt: "p",
			workspaceRoot: "/ws",
			enabled: true,
			schedule: "0 2 * * *",
			timezone: "UTC",
		};
		const result = store.upsertSpec({
			externalId: "nightly",
			sourcePath: "nightly.cron.md",
			triggerKind: "schedule",
			sourceHash: "h",
			parseStatus: "valid",
			spec,
		});
		expect(result.record.scheduleExpr).toBe("0 2 * * *");
		expect(result.record.timezone).toBe("UTC");
	});
});
