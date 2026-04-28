import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CronMaterializer } from "../runner/cron-materializer";
import { SqliteCronStore } from "../store/sqlite-cron-store";
import { CronReconciler } from "./cron-reconciler";
import { CronWatcher } from "./cron-watcher";

describe("CronWatcher", () => {
	let root: string;
	let cronDir: string;
	let store: SqliteCronStore;
	let reconciler: CronReconciler;
	let materializer: CronMaterializer;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "cline-watcher-"));
		cronDir = join(root, "cron-specs");
		mkdirSync(cronDir, { recursive: true });
		store = new SqliteCronStore({ dbPath: join(root, "cron.db") });
		reconciler = new CronReconciler({
			store,
			specs: { cronSpecsDir: cronDir },
		});
		materializer = new CronMaterializer({ store });
	});

	afterEach(() => {
		store.close();
		rmSync(root, { recursive: true, force: true });
	});

	it("materializes after a watched file reconcile", async () => {
		const specPath = join(cronDir, "cleanup.md");
		writeFileSync(
			specPath,
			`---\nid: cleanup\nworkspaceRoot: /ws\n---\nRemove stale files`,
			"utf8",
		);
		let materialized = 0;
		const watcher = new CronWatcher({
			reconciler,
			onReconciled: () => {
				materialized += materializer.materializeAll().oneOffQueued;
			},
		});

		await (
			watcher as unknown as { reconcileNow(path: string): Promise<void> }
		).reconcileNow("cleanup.md");

		expect(materialized).toBe(1);
		const spec = store.listSpecs()[0]!;
		const runs = store.listRuns({ specId: spec.specId });
		expect(runs).toHaveLength(1);
		expect(runs[0]?.status).toBe("queued");
	});

	it("creates the cron directory before starting the watcher", () => {
		const missingCronDir = join(root, "missing-cron-specs");
		const watcherReconciler = new CronReconciler({
			store,
			specs: { cronSpecsDir: missingCronDir },
		});
		const watcher = new CronWatcher({ reconciler: watcherReconciler });

		watcher.start();
		watcher.stop();

		expect(existsSync(missingCronDir)).toBe(true);
	});
});
