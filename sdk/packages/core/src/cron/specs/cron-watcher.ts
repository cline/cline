import type { FSWatcher } from "node:fs";
import { existsSync, mkdirSync, watch } from "node:fs";
import { relative, resolve } from "node:path";
import type { CronReconciler } from "./cron-reconciler";

/**
 * Filesystem watcher for the configured cron specs directory.
 *
 * Uses `node:fs` `watch` with `{ recursive: true }`. Emits a re-reconcile
 * request for each change, debounced per path, so rapid save bursts from
 * editors don't cause redundant DB churn.
 */

const DEFAULT_DEBOUNCE_MS = 250;

export interface CronWatcherOptions {
	reconciler: CronReconciler;
	debounceMs?: number;
	onError?: (error: unknown) => void;
	onReconciled?: () => void | Promise<void>;
}

export class CronWatcher {
	private readonly reconciler: CronReconciler;
	private readonly debounceMs: number;
	private readonly onError: (error: unknown) => void;
	private readonly onReconciled: () => void | Promise<void>;
	private watcher?: FSWatcher;
	private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();
	private disposed = false;

	constructor(options: CronWatcherOptions) {
		this.reconciler = options.reconciler;
		this.debounceMs = Math.max(0, options.debounceMs ?? DEFAULT_DEBOUNCE_MS);
		this.onError = options.onError ?? (() => {});
		this.onReconciled = options.onReconciled ?? (() => {});
	}

	public start(): void {
		if (this.disposed) throw new Error("CronWatcher disposed");
		if (this.watcher) return;
		const dir = this.reconciler.getCronDir();
		try {
			mkdirSync(dir, { recursive: true });
			this.watcher = watch(dir, { recursive: true }, (_eventType, filename) => {
				if (!filename) return;
				const rel = String(filename).replace(/\\/g, "/");
				if (!rel.endsWith(".md")) return;
				if (rel.startsWith("reports/")) return;
				this.scheduleReconcile(rel);
			});
			this.watcher.on("error", this.onError);
		} catch (err) {
			this.onError(err);
		}
	}

	public stop(): void {
		for (const timer of this.pending.values()) clearTimeout(timer);
		this.pending.clear();
		this.watcher?.close();
		this.watcher = undefined;
	}

	public dispose(): void {
		this.disposed = true;
		this.stop();
	}

	private scheduleReconcile(relativePath: string): void {
		const existing = this.pending.get(relativePath);
		if (existing) clearTimeout(existing);
		const timer = setTimeout(() => {
			this.pending.delete(relativePath);
			void this.reconcileNow(relativePath);
		}, this.debounceMs);
		this.pending.set(relativePath, timer);
	}

	private async reconcileNow(relativePath: string): Promise<void> {
		try {
			const abs = resolve(this.reconciler.getCronDir(), relativePath);
			if (!existsSync(abs)) {
				// File was deleted — force a full reconcile to catch the
				// missing source and mark the spec removed.
				await this.reconciler.reconcileAll();
				await this.onReconciled();
				return;
			}
			// Normalize relative path through the reconciler dir to defend
			// against a watcher emitting an unexpected format.
			const normalizedRel = relative(this.reconciler.getCronDir(), abs).replace(
				/\\/g,
				"/",
			);
			await this.reconciler.reconcileFile(normalizedRel, abs);
			await this.onReconciled();
		} catch (err) {
			this.onError(err);
		}
	}
}
