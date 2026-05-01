import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteCronStore } from "../store/sqlite-cron-store";
import { CronReconciler } from "./cron-reconciler";

describe("CronReconciler", () => {
	let root: string;
	let cronDir: string;
	let dbPath: string;
	let store: SqliteCronStore;
	let reconciler: CronReconciler;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "cline-reconciler-"));
		cronDir = join(root, "cron-specs");
		mkdirSync(cronDir, { recursive: true });
		dbPath = join(root, "cron.db");
		store = new SqliteCronStore({ dbPath });
		reconciler = new CronReconciler({
			store,
			specs: { cronSpecsDir: cronDir },
		});
	});

	afterEach(() => {
		store.close();
		rmSync(root, { recursive: true, force: true });
	});

	function writeSpec(rel: string, content: string) {
		const full = join(cronDir, rel);
		mkdirSync(join(full, ".."), { recursive: true });
		writeFileSync(full, content, "utf8");
	}

	function requireValue<T>(value: T | undefined): T {
		expect(value).toBeDefined();
		if (value === undefined) {
			throw new Error("Expected value to be defined");
		}
		return value;
	}

	it("imports valid one-off and schedule specs on startup", async () => {
		writeSpec(
			"cleanup.md",
			`---\nid: cleanup\nworkspaceRoot: /ws\n---\nRemove stale files`,
		);
		writeSpec(
			"nightly.cron.md",
			`---\nid: nightly\nworkspaceRoot: /ws\nschedule: "0 2 * * *"\n---\nNightly`,
		);

		const summary = await reconciler.reconcileAll();
		expect(summary.scanned).toBe(2);
		expect(summary.upserted).toBe(2);
		expect(summary.invalidParses).toBe(0);

		const specs = store.listSpecs();
		expect(specs.length).toBe(2);
		const schedule = specs.find((s) => s.triggerKind === "schedule");
		expect(schedule?.scheduleExpr).toBe("0 2 * * *");
		expect(schedule?.nextRunAt).toBeDefined();
	});

	it("records invalid specs without failing the whole scan", async () => {
		writeSpec("bad.md", `---\nid: [unclosed\n---\nbody`);
		writeSpec(
			"good.md",
			`---\nid: good\nworkspaceRoot: /ws\n---\nDo good work`,
		);

		const summary = await reconciler.reconcileAll();
		expect(summary.upserted).toBe(2);
		expect(summary.invalidParses).toBe(1);

		const invalid = store
			.listSpecs({ parseStatus: "invalid" })
			.find((s) => s.sourcePath === "bad.md");
		expect(invalid).toBeDefined();
		expect(invalid?.parseError).toBeTruthy();
		expect(invalid?.enabled).toBe(false);

		const valid = store
			.listSpecs({ parseStatus: "valid" })
			.find((s) => s.sourcePath === "good.md");
		expect(valid?.enabled).toBe(true);
	});

	it("marks specs as removed when source files disappear", async () => {
		writeSpec("cleanup.md", `---\nid: cleanup\nworkspaceRoot: /ws\n---\nBody`);
		await reconciler.reconcileAll();
		rmSync(join(cronDir, "cleanup.md"));

		const summary = await reconciler.reconcileAll();
		expect(summary.removed).toBe(1);

		const remaining = store.listSpecs({ includeRemoved: false });
		expect(remaining.length).toBe(0);
		const all = store.listSpecs({ includeRemoved: true });
		expect(all[0]?.removed).toBe(true);
	});

	it("cancels queued runs when spec is removed", async () => {
		writeSpec("cleanup.md", `---\nid: cleanup\nworkspaceRoot: /ws\n---\nBody`);
		await reconciler.reconcileAll();
		const spec = requireValue(store.listSpecs()[0]);
		store.enqueueRun({
			specId: spec.specId,
			specRevision: spec.revision,
			triggerKind: "one_off",
		});

		rmSync(join(cronDir, "cleanup.md"));
		await reconciler.reconcileAll();

		const run = requireValue(store.listRuns({ specId: spec.specId })[0]);
		expect(run.status).toBe("cancelled");
	});

	it("preserves overdue schedule next_run_at on startup refresh", async () => {
		writeSpec(
			"nightly.cron.md",
			`---\nid: nightly\nworkspaceRoot: /ws\nschedule: "* * * * *"\n---\nNightly`,
		);
		await reconciler.reconcileAll();
		const spec = requireValue(store.listSpecs({ triggerKind: "schedule" })[0]);
		const overdue = new Date(Date.now() - 60_000).toISOString();
		store.updateSpecNextRunAt(spec.specId, overdue);

		reconciler.refreshScheduleNextRunAt();

		const refreshed = requireValue(store.getSpec(spec.specId));
		expect(refreshed.nextRunAt).toBe(overdue);
	});
});
