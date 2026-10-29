import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	watch,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CronMaterializer } from "../runner/cron-materializer";
import { SqliteCronStore } from "../store/sqlite-cron-store";
import { CronReconciler } from "./cron-reconciler";
import { CronWatcher } from "./cron-watcher";

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return { ...actual, watch: vi.fn(actual.watch) };
});

describe("CronWatcher", () => {
	let root: string;
	let cronDir: string;
	let store: SqliteCronStore;
	let reconciler: CronReconciler;
	let materializer: CronMaterializer;

	beforeEach(() => {
		vi.mocked(watch).mockClear();
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
		vi.restoreAllMocks();
		store.close();
		rmSync(root, { recursive: true, force: true });
	});

	function requireValue<T>(value: T | undefined): T {
		expect(value).toBeDefined();
		if (value === undefined) {
			throw new Error("Expected value to be defined");
		}
		return value;
	}

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
		const spec = requireValue(store.listSpecs()[0]);
		const runs = store.listRuns({ specId: spec.specId });
		expect(runs).toHaveLength(1);
		expect(runs[0]?.status).toBe("queued");
	});

	it("watches the native canonical path rather than a Windows short-path alias", () => {
		const canonicalDir = realpathSync.native(cronDir);
		const resolvePath = vi.spyOn(realpathSync, "native");
		const watcher = new CronWatcher({ reconciler });
		try {
			watcher.start();
			expect(resolvePath).toHaveBeenCalledWith(cronDir);
			expect(watch).toHaveBeenCalledExactlyOnceWith(
				canonicalDir,
				{ recursive: true },
				expect.any(Function),
			);
		} finally {
			watcher.dispose();
		}
	});

	it("reports resolution failure without watching the unresolved path", () => {
		const error = new Error("Cannot resolve watcher directory");
		vi.spyOn(realpathSync, "native").mockImplementationOnce(() => {
			throw error;
		});
		const onError = vi.fn();
		const watcher = new CronWatcher({ reconciler, onError });
		try {
			watcher.start();
			expect(onError).toHaveBeenCalledExactlyOnceWith(error);
			expect(watch).not.toHaveBeenCalled();
		} finally {
			watcher.dispose();
		}
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
