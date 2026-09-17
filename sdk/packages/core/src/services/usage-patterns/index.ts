import { createYieldIfBusy, HeadCache } from "./head";
import {
	buildCombinedPatterns,
	buildSourcePatterns,
	type PatternWindow,
} from "./patterns";
import {
	defaultUsageRoots,
	emptyCoverage,
	readClaudeSessions,
	readClineSessions,
	readCodexSessions,
	type SourceReadOptions,
	type SourceReadResult,
	type UsageSourceRoots,
} from "./sources";
import {
	type SessionMeta,
	type SourcePatterns,
	USAGE_SOURCES,
	type UsagePatternsReport,
	type UsageSourceId,
} from "./types";

export type { UsageSourceRoots } from "./sources";
export type {
	CombinedPatterns,
	LifecyclePattern,
	ProjectPattern,
	RhythmPattern,
	SourceAvailability,
	SourceCoverage,
	SourcePatterns,
	SpanPattern,
	UsagePatternsReport,
	UsageSourceId,
	WorkflowPattern,
} from "./types";
export { USAGE_SOURCE_LABELS, USAGE_SOURCES } from "./types";

const DEFAULT_RANGE_DAYS = 30;
const DEFAULT_CACHE_TTL_MS = 60_000;
/** Longest stretch a scan holds the event loop before yielding to other work. */
const DEFAULT_SLICE_MS = 8;
/**
 * The window is `rangeDays` calendar days ending today, starting at local
 * midnight. Counting back `rangeDays` x 24h from now would reach into one
 * more calendar day, so a 30-day window could report 31 active days.
 */
export function windowStartMs(nowMs: number, rangeDays: number): number {
	const today = new Date(nowMs);
	return new Date(
		today.getFullYear(),
		today.getMonth(),
		today.getDate() - (Math.max(1, rangeDays) - 1),
	).getTime();
}

export interface UsagePatternsOptions {
	/** Overrides for tests and non-default install layouts. */
	roots?: Partial<UsageSourceRoots>;
	now?: () => number;
	cacheTtlMs?: number;
	sliceMs?: number;
}

type SourceReader = (
	roots: UsageSourceRoots,
	options: SourceReadOptions,
) => Promise<SourceReadResult>;

const READERS: Record<UsageSourceId, SourceReader> = {
	cline: readClineSessions,
	codex: readCodexSessions,
	"claude-code": readClaudeSessions,
};

/**
 * Local usage-pattern reader across the agents installed on this machine.
 *
 * Reads session metadata only: directory listings, file stats, a bounded head
 * of each session file touched inside the window, and Cline's session index.
 * The scan yields to the event loop as it goes, concurrent callers share one
 * scan, unchanged files are not re-read, and reports are cached briefly
 * because the desktop UI re-reads on mount and on refresh.
 */
export class UsagePatternsService {
	private readonly roots: UsageSourceRoots;
	private readonly now: () => number;
	private readonly cacheTtlMs: number;
	private readonly sliceMs: number;
	private readonly heads = new HeadCache();
	private readonly pending = new Map<number, Promise<UsagePatternsReport>>();
	private cache?: {
		at: number;
		rangeDays: number;
		report: UsagePatternsReport;
	};

	constructor(options: UsagePatternsOptions = {}) {
		this.roots = { ...defaultUsageRoots(), ...options.roots };
		this.now = options.now ?? Date.now;
		this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
		this.sliceMs = options.sliceMs ?? DEFAULT_SLICE_MS;
	}

	read(rangeDays = DEFAULT_RANGE_DAYS): Promise<UsagePatternsReport> {
		const nowMs = this.now();
		const cached = this.cache;
		if (
			cached &&
			cached.rangeDays === rangeDays &&
			nowMs - cached.at < this.cacheTtlMs
		) {
			return Promise.resolve(cached.report);
		}
		const inFlight = this.pending.get(rangeDays);
		if (inFlight) return inFlight;
		const scan = this.scan(rangeDays, nowMs).finally(() => {
			this.pending.delete(rangeDays);
		});
		this.pending.set(rangeDays, scan);
		return scan;
	}

	/** Drops the cached report so the next read rescans. */
	invalidate(): void {
		this.cache = undefined;
	}

	private async scan(
		rangeDays: number,
		nowMs: number,
	): Promise<UsagePatternsReport> {
		const startedAt = this.now();
		const window: PatternWindow = {
			sinceMs: windowStartMs(nowMs, rangeDays),
			nowMs,
		};
		const options: SourceReadOptions = {
			sinceMs: window.sinceMs,
			cache: this.heads,
			yieldIfBusy: createYieldIfBusy(this.sliceMs),
		};
		this.heads.beginScan();

		const sources: SourcePatterns[] = [];
		const everySession: SessionMeta[] = [];
		for (const source of USAGE_SOURCES) {
			let read: SourceReadResult;
			try {
				read = await READERS[source](this.roots, options);
			} catch {
				read = {
					availability: {
						source,
						installed: false,
						note: "scan failed",
						coverage: emptyCoverage(),
					},
					sessions: [],
				};
			}
			sources.push(
				buildSourcePatterns({
					availability: read.availability,
					sessions: read.sessions,
					window,
				}),
			);
			for (const session of read.sessions) everySession.push(session);
		}

		const report: UsagePatternsReport = {
			generatedAtMs: nowMs,
			scanMs: this.now() - startedAt,
			rangeDays,
			sources,
			combined: buildCombinedPatterns(everySession, window),
		};
		this.cache = { at: nowMs, rangeDays, report };
		return report;
	}
}
