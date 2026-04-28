import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { relative } from "node:path";
import type { CronSpecParseResult } from "@clinebot/shared";
import {
	type ResolveCronSpecsDirOptions,
	resolveCronSpecsDir,
} from "@clinebot/shared/storage";
import { getNextCronTime } from "../schedule/scheduler";
import type {
	CronSpecRecord,
	SqliteCronStore,
	UpsertSpecResult,
} from "../store/sqlite-cron-store";
import { type ParseCronSpecInput, parseCronSpecFile } from "./cron-spec-parser";

/**
 * Scan the configured cron specs directory on disk, parse every file, and
 * upsert spec state into the cron DB. This is the startup source of truth:
 * watcher events are triggers to re-run reconciliation for one file, not a
 * replacement.
 */

export interface CronReconcilerOptions {
	store: SqliteCronStore;
	/**
	 * Cron spec source location. Defaults to global `~/.cline/cron`.
	 * Pass `{ scope: "workspace", workspaceRoot }` later to enable
	 * workspace-level cron sources without changing reconciler internals.
	 */
	specs?: ResolveCronSpecsDirOptions;
	/** @deprecated Use `specs: { scope: "workspace", workspaceRoot }`. */
	workspaceRoot?: string;
}

export interface ReconcileChange {
	relativePath: string;
	result: UpsertSpecResult;
	parse: CronSpecParseResult;
}

export interface ReconcileSummary {
	scanned: number;
	upserted: number;
	invalidParses: number;
	removed: number;
	changes: ReconcileChange[];
}

function toPosixRelative(fromDir: string, absolutePath: string): string {
	return relative(fromDir, absolutePath).replace(/\\/g, "/");
}

function walk(dir: string): string[] {
	if (!existsSync(dir)) return [];
	const result: string[] = [];
	const stack: string[] = [dir];
	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) continue;
		let entries: import("node:fs").Dirent[];
		try {
			entries = readdirSync(current, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const full = `${current}/${entry.name}`;
			if (entry.isDirectory()) {
				// Skip the generated reports subdirectory — not spec sources.
				if (entry.name === "reports") continue;
				stack.push(full);
				continue;
			}
			if (!entry.isFile()) continue;
			if (!entry.name.endsWith(".md")) continue;
			result.push(full);
		}
	}
	return result;
}

export class CronReconciler {
	private readonly store: SqliteCronStore;
	private readonly cronDir: string;

	constructor(options: CronReconcilerOptions) {
		this.store = options.store;
		this.cronDir = resolveCronSpecsDir(
			options.specs ??
				(options.workspaceRoot
					? { scope: "workspace", workspaceRoot: options.workspaceRoot }
					: undefined),
		);
	}

	public getCronDir(): string {
		return this.cronDir;
	}

	/**
	 * Reconcile every file under the cron specs directory into the DB and mark specs
	 * whose source files no longer exist as `removed=1`.
	 */
	public async reconcileAll(): Promise<ReconcileSummary> {
		const summary: ReconcileSummary = {
			scanned: 0,
			upserted: 0,
			invalidParses: 0,
			removed: 0,
			changes: [],
		};

		const files = walk(this.cronDir);
		const seenPaths = new Set<string>();

		for (const abs of files) {
			const rel = toPosixRelative(this.cronDir, abs);
			seenPaths.add(rel);
			summary.scanned += 1;
			const change = await this.reconcileFile(rel, abs);
			if (change) {
				summary.changes.push(change);
				summary.upserted += 1;
				if (change.parse.error) summary.invalidParses += 1;
			}
		}

		const existing = this.store.listSpecs({
			includeRemoved: false,
			limit: 10_000,
		});
		for (const spec of existing) {
			if (!seenPaths.has(spec.sourcePath)) {
				this.handleFileDeleted(spec);
				summary.removed += 1;
			}
		}

		this.refreshScheduleNextRunAt();

		return summary;
	}

	/**
	 * Reconcile a single file (absolute path). `relativePath` is expected to
	 * be POSIX-relative to the cron specs directory. Returns the reconciliation change
	 * or undefined if the file could not be read.
	 */
	public async reconcileFile(
		relativePath: string,
		absolutePath: string,
	): Promise<ReconcileChange | undefined> {
		const existing = this.store.getSpecBySourcePath(relativePath);
		let raw: string;
		let mtimeMs: number | undefined;
		try {
			raw = readFileSync(absolutePath, "utf8");
			mtimeMs = statSync(absolutePath).mtimeMs;
		} catch {
			return undefined;
		}
		const input: ParseCronSpecInput = { relativePath, raw };
		const parse = parseCronSpecFile(input);
		const result = this.store.upsertSpec({
			externalId: parse.externalId,
			sourcePath: relativePath,
			triggerKind: parse.triggerKind,
			sourceMtimeMs: mtimeMs,
			sourceHash: parse.contentHash,
			parseStatus: parse.error ? "invalid" : "valid",
			parseError: parse.error,
			spec: parse.spec,
		});

		// For valid schedule specs, compute next_run_at if missing or reset
		// when schedule_expr changed.
		if (
			!parse.error &&
			parse.triggerKind === "schedule" &&
			result.record.enabled
		) {
			this.applyScheduleNextRunAt(result.record, {
				forceReset:
					!existing ||
					existing.removed ||
					!existing.enabled ||
					existing.scheduleExpr !== result.record.scheduleExpr ||
					existing.timezone !== result.record.timezone,
			});
		}

		return { relativePath, result, parse };
	}

	/**
	 * Handle a file that disappeared from disk between reconciliations.
	 * Marks the spec as removed and cancels any queued runs for it.
	 */
	public handleFileDeleted(spec: CronSpecRecord): void {
		this.store.markSpecRemoved(spec.specId);
		this.store.cancelQueuedRunsForSpec(spec.specId);
	}

	/**
	 * Refresh next_run_at for every enabled schedule spec.
	 * Used at startup to handle the "one overdue catch-up on startup then
	 * advance to next slot" policy.
	 */
	public refreshScheduleNextRunAt(): void {
		const schedules = this.store.listSpecs({
			triggerKind: "schedule",
			enabled: true,
			parseStatus: "valid",
		});
		for (const spec of schedules) {
			this.applyScheduleNextRunAt(spec, { forceReset: false });
		}
	}

	private applyScheduleNextRunAt(
		spec: CronSpecRecord,
		options: { forceReset: boolean },
	): void {
		if (!spec.scheduleExpr) return;
		if (!options.forceReset && spec.nextRunAt) return;
		try {
			const now = Date.now();
			const base = spec.lastRunAt
				? Math.max(now, new Date(spec.lastRunAt).getTime())
				: now;
			const nextMs = getNextCronTime(spec.scheduleExpr, base, spec.timezone);
			const nextIso = new Date(nextMs).toISOString();
			if (spec.nextRunAt !== nextIso) {
				this.store.updateSpecNextRunAt(spec.specId, nextIso);
			}
		} catch {
			// Invalid cron pattern — leave next_run_at as is; the upsert's
			// parse_status already reflects the spec correctness.
		}
	}
}
