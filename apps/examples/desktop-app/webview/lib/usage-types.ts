/**
 * Wire types for the sidecar's usage-pattern commands.
 *
 * Mirrors sdk/packages/core/src/services/usage-patterns/types.ts, kept as a
 * local copy so the client bundle never imports node-only core code (same
 * reason session-import.ts duplicates its types).
 */

export type UsageSourceId = "cline" | "codex" | "claude-code";

export const USAGE_SOURCE_LABELS: Record<UsageSourceId, string> = {
	cline: "Cline",
	codex: "Codex",
	"claude-code": "Claude Code",
};

export interface SourceCoverage {
	scanned: number;
	recognized: number;
	skipped: Record<string, number>;
	oldestSessionMs: number | null;
}

export interface SourceAvailability {
	source: UsageSourceId;
	installed: boolean;
	root?: string;
	note?: string;
	coverage: SourceCoverage;
}

/** Root sessions started inside the window; active days count any activity. */
export interface RhythmPattern {
	hourHistogram: number[];
	weekdayHourMatrix: number[][];
	daily: Array<{ date: string; started: number }>;
	activeDays: number;
	firstActiveMs: number | null;
	currentStreakDays: number;
	longestStreakDays: number;
	peakHour: number | null;
	nightShare: number;
}

export interface WorkflowPattern {
	sessions: number;
	rootSessions: number;
	subagentSessions: number;
	orchestrationShare: number;
	maxDepth: number;
	depthHistogram: Record<string, number>;
}

export interface ProjectPattern {
	project: string;
	sessions: number;
	activeDays: number;
	lastActiveMs: number;
	subagentSessions: number;
}

export interface SpanPattern {
	/** Root-session buckets by span; sums to the root sessions started. */
	buckets: {
		under10m: number;
		under1h: number;
		under4h: number;
		under24h: number;
		over24h: number;
	};
}

export interface LifecyclePattern {
	terminalSessions: number;
	failedSessions: number;
}

export interface SourcePatterns {
	availability: SourceAvailability;
	rhythm: RhythmPattern;
	workflow: WorkflowPattern;
	projects: ProjectPattern[];
	span: SpanPattern;
	lifecycle: LifecyclePattern;
}

/** Every installed source merged from raw sessions; span is per source only. */
export interface CombinedPatterns {
	rhythm: RhythmPattern;
	workflow: WorkflowPattern;
	projects: ProjectPattern[];
	lifecycle: LifecyclePattern;
}

export interface UsagePatternsReport {
	generatedAtMs: number;
	scanMs: number;
	rangeDays: number;
	sources: SourcePatterns[];
	combined: CombinedPatterns;
}
