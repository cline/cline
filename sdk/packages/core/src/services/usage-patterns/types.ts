/**
 * Local agent-usage *pattern* model.
 *
 * The dashboard is pattern-first: rhythm, workflow style, portfolio and session
 * span are derived from session metadata (timestamps, project paths,
 * parent/child topology) rather than from token accounting. Token totals are
 * never read — the stores report incompatible token semantics, none of them
 * carries real billing, and counting them would mean reading message bodies.
 */
export const USAGE_SOURCES = ["cline", "codex", "claude-code"] as const;

export type UsageSourceId = (typeof USAGE_SOURCES)[number];

export const USAGE_SOURCE_LABELS: Record<UsageSourceId, string> = {
	cline: "Cline",
	codex: "Codex",
	"claude-code": "Claude Code",
};

export type SessionKind = "root" | "subagent";

export type SessionOutcome =
	| "completed"
	| "aborted"
	| "failed"
	| "running"
	| "unknown";

/** One discovered session. Everything here is cheap to obtain. */
export interface SessionMeta {
	source: UsageSourceId;
	sessionKey: string;
	kind: SessionKind;
	/** Orchestration nesting, when the source records it (Codex does). */
	depth?: number;
	/** Normalized project label (cwd-derived); "" when unknown. */
	project: string;
	startedAtMs: number;
	/** Last local activity: the file's mtime, or the store's own update time. */
	lastActivityMs?: number;
	outcome: SessionOutcome;
}

/**
 * What a reader looked at and what it refused to guess about. Files it could
 * not read metadata from are counted here instead of falling back to values
 * that would look plausible and be wrong.
 */
export interface SourceCoverage {
	/** Session files (or rows) last touched inside the window. */
	scanned: number;
	/** Of those, sessions whose metadata was recognized. */
	recognized: number;
	/** Files left out, by reason. */
	skipped: Record<string, number>;
	/** Oldest session still on disk; tools prune their history differently. */
	oldestSessionMs: number | null;
}

export interface SourceAvailability {
	source: UsageSourceId;
	installed: boolean;
	/** Store the sessions came from, for the UI's empty-state copy. */
	root?: string;
	/** Reason the source produced nothing, when it is not "not installed". */
	note?: string;
	coverage: SourceCoverage;
}

/**
 * When work starts. Counts use root sessions started inside the window:
 * subagent runs arrive in bursts that say how a tool fans out, not when you
 * work. Active days also count any session starting or active that day.
 */
export interface RhythmPattern {
	/** Root sessions started per local hour, index 0-23. */
	hourHistogram: number[];
	/** Root sessions per (weekday, hour) cell: 7 rows Monday-first, 24 columns. */
	weekdayHourMatrix: number[][];
	/** Every day with activity inside the window, oldest first. */
	daily: Array<{ date: string; started: number }>;
	activeDays: number;
	firstActiveMs: number | null;
	currentStreakDays: number;
	longestStreakDays: number;
	peakHour: number | null;
	/** Share of root sessions started between 00:00 and 05:59. */
	nightShare: number;
}

/** Sessions started inside the window. */
export interface WorkflowPattern {
	sessions: number;
	rootSessions: number;
	subagentSessions: number;
	/** Subagents / sessions. */
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

/**
 * Root-session span distribution.
 *
 * Span runs from the session's first recorded event to its last local activity,
 * so it *includes idle gaps*: Claude Code keeps appending to one transcript
 * across resumes, while Codex writes short rollouts. Spans are comparable
 * within a source and never across sources, which is why they are only
 * reported per source.
 */
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

/**
 * Lifecycle state, where the source records one (only Cline does). Sessions
 * still idle or running are not counted: an open session has no outcome yet.
 */
export interface LifecyclePattern {
	/** Root sessions that reached a terminal state the source reports. */
	terminalSessions: number;
	/** Of those, sessions that failed or were aborted. */
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

/**
 * Every installed source, merged from the raw sessions rather than from each
 * source's aggregates — medians, unions of active days and weighted shares
 * cannot be recovered from summaries. Span is deliberately absent.
 */
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
