import type {
	CombinedPatterns,
	LifecyclePattern,
	ProjectPattern,
	RhythmPattern,
	SessionMeta,
	SourcePatterns,
	SpanPattern,
	WorkflowPattern,
} from "./types";

const MS_PER_DAY = 86_400_000;
/** Root sessions started before 06:00 count toward the night share. */
const NIGHT_END_HOUR = 6;
const TEN_MINUTES_MS = 10 * 60_000;
const HOUR_MS = 60 * 60_000;
const FOUR_HOURS_MS = 4 * HOUR_MS;

/** The report window, inclusive: [sinceMs, nowMs]. */
export interface PatternWindow {
	sinceMs: number;
	nowMs: number;
}

function localDayKey(ms: number): string {
	const date = new Date(ms);
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
		date.getDate(),
	).padStart(2, "0")}`;
}

function dayKeyMs(key: string): number {
	return Date.parse(`${key}T12:00:00`);
}

function inWindow(ms: number | undefined, window: PatternWindow): boolean {
	return ms != null && ms >= window.sinceMs && ms <= window.nowMs;
}

/**
 * Every count uses sessions that *started* inside the window. A session that
 * started earlier and was resumed inside it only adds an active day.
 */
function startedInWindow(session: SessionMeta, window: PatternWindow): boolean {
	return inWindow(session.startedAtMs, window);
}

export function buildRhythm(
	sessions: SessionMeta[],
	window: PatternWindow,
): RhythmPattern {
	const hourHistogram = Array.from({ length: 24 }, () => 0);
	const weekdayHourMatrix = Array.from({ length: 7 }, () =>
		Array.from({ length: 24 }, () => 0),
	);
	const startedPerDay = new Map<string, number>();
	const activeDays = new Set<string>();
	let firstActiveMs = Number.POSITIVE_INFINITY;
	let roots = 0;
	let night = 0;

	const markActive = (ms: number | undefined) => {
		if (ms == null || !inWindow(ms, window)) return;
		activeDays.add(localDayKey(ms));
		firstActiveMs = Math.min(firstActiveMs, ms);
	};

	for (const session of sessions) {
		markActive(session.startedAtMs);
		markActive(session.lastActivityMs);
		// Subagent runs arrive in bursts that describe how a tool fans out, not
		// when you work, so the rhythm counts root sessions only.
		if (session.kind !== "root" || !startedInWindow(session, window)) continue;
		const date = new Date(session.startedAtMs);
		const weekday = (date.getDay() + 6) % 7; // Monday-first
		const hour = date.getHours();
		roots += 1;
		hourHistogram[hour] += 1;
		(weekdayHourMatrix[weekday] as number[])[hour] += 1;
		if (hour < NIGHT_END_HOUR) night += 1;
		const key = localDayKey(session.startedAtMs);
		startedPerDay.set(key, (startedPerDay.get(key) ?? 0) + 1);
	}

	const days = [...activeDays].sort();
	let longest = 0;
	let run = 0;
	let previousMs: number | null = null;
	for (const day of days) {
		const ms = dayKeyMs(day);
		run =
			previousMs != null && ms - previousMs <= MS_PER_DAY * 1.5 ? run + 1 : 1;
		longest = Math.max(longest, run);
		previousMs = ms;
	}
	const lastDay = days[days.length - 1];
	const current =
		lastDay === localDayKey(window.nowMs) ||
		lastDay === localDayKey(window.nowMs - MS_PER_DAY)
			? run
			: 0;

	let peakHour: number | null = null;
	let peakCount = 0;
	for (let hour = 0; hour < hourHistogram.length; hour += 1) {
		const count = hourHistogram[hour] as number;
		if (count > peakCount) {
			peakCount = count;
			peakHour = hour;
		}
	}

	return {
		hourHistogram,
		weekdayHourMatrix,
		daily: days.map((date) => ({
			date,
			started: startedPerDay.get(date) ?? 0,
		})),
		activeDays: days.length,
		firstActiveMs: Number.isFinite(firstActiveMs) ? firstActiveMs : null,
		currentStreakDays: current,
		longestStreakDays: longest,
		peakHour,
		nightShare: roots === 0 ? 0 : night / roots,
	};
}

export function buildWorkflow(
	sessions: SessionMeta[],
	window: PatternWindow,
): WorkflowPattern {
	const depthHistogram: Record<string, number> = {};
	let rootSessions = 0;
	let subagentSessions = 0;
	let maxDepth = 0;

	for (const session of sessions) {
		if (!startedInWindow(session, window)) continue;
		if (session.kind === "root") rootSessions += 1;
		else subagentSessions += 1;
		if (session.depth != null) {
			const key = String(session.depth);
			depthHistogram[key] = (depthHistogram[key] ?? 0) + 1;
			maxDepth = Math.max(maxDepth, session.depth);
		}
	}

	const total = rootSessions + subagentSessions;
	return {
		sessions: total,
		rootSessions,
		subagentSessions,
		orchestrationShare: total === 0 ? 0 : subagentSessions / total,
		maxDepth,
		depthHistogram: Object.fromEntries(
			Object.entries(depthHistogram).sort(
				(a, b) => Number(a[0]) - Number(b[0]),
			),
		),
	};
}

export function buildProjects(
	sessions: SessionMeta[],
	window: PatternWindow,
): ProjectPattern[] {
	const byProject = new Map<
		string,
		{
			sessions: number;
			days: Set<string>;
			lastActiveMs: number;
			subagentSessions: number;
		}
	>();
	for (const session of sessions) {
		if (!startedInWindow(session, window)) continue;
		const project = session.project || "(unknown)";
		const entry = byProject.get(project) ?? {
			sessions: 0,
			days: new Set<string>(),
			lastActiveMs: 0,
			subagentSessions: 0,
		};
		entry.sessions += 1;
		entry.days.add(localDayKey(session.startedAtMs));
		entry.lastActiveMs = Math.max(
			entry.lastActiveMs,
			session.lastActivityMs ?? session.startedAtMs,
		);
		if (session.kind === "subagent") entry.subagentSessions += 1;
		byProject.set(project, entry);
	}
	return [...byProject.entries()]
		.map(([project, entry]) => ({
			project,
			sessions: entry.sessions,
			activeDays: entry.days.size,
			lastActiveMs: entry.lastActiveMs,
			subagentSessions: entry.subagentSessions,
		}))
		.sort((a, b) => b.sessions - a.sessions || b.lastActiveMs - a.lastActiveMs);
}

export function buildSpan(
	sessions: SessionMeta[],
	window: PatternWindow,
): SpanPattern {
	const buckets = {
		under10m: 0,
		under1h: 0,
		under4h: 0,
		under24h: 0,
		over24h: 0,
	};
	// Only root sessions: a burst of subagent rollouts is one orchestration run.
	for (const session of sessions) {
		if (session.kind !== "root" || !startedInWindow(session, window)) continue;
		const span = Math.max(
			0,
			(session.lastActivityMs ?? session.startedAtMs) - session.startedAtMs,
		);
		if (span < TEN_MINUTES_MS) buckets.under10m += 1;
		else if (span < HOUR_MS) buckets.under1h += 1;
		else if (span < FOUR_HOURS_MS) buckets.under4h += 1;
		else if (span < MS_PER_DAY) buckets.under24h += 1;
		else buckets.over24h += 1;
	}
	return { buckets };
}

export function buildLifecycle(
	sessions: SessionMeta[],
	window: PatternWindow,
): LifecyclePattern {
	let terminalSessions = 0;
	let failedSessions = 0;
	for (const session of sessions) {
		if (session.kind !== "root" || !startedInWindow(session, window)) continue;
		// "running" is still open and "unknown" means the source records no
		// state; neither is an outcome, so neither can read as a success.
		if (session.outcome === "completed") {
			terminalSessions += 1;
		} else if (session.outcome === "failed" || session.outcome === "aborted") {
			terminalSessions += 1;
			failedSessions += 1;
		}
	}
	return { terminalSessions, failedSessions };
}

export function buildSourcePatterns(input: {
	availability: SourcePatterns["availability"];
	sessions: SessionMeta[];
	window: PatternWindow;
}): SourcePatterns {
	const { availability, sessions, window } = input;
	return {
		availability,
		rhythm: buildRhythm(sessions, window),
		workflow: buildWorkflow(sessions, window),
		projects: buildProjects(sessions, window),
		span: buildSpan(sessions, window),
		lifecycle: buildLifecycle(sessions, window),
	};
}

/**
 * All installed sources at once, rebuilt from their raw sessions: peak hour,
 * night share and active days are properties of the union, not something that
 * can be derived from each source's own summary.
 */
export function buildCombinedPatterns(
	sessions: SessionMeta[],
	window: PatternWindow,
): CombinedPatterns {
	return {
		rhythm: buildRhythm(sessions, window),
		workflow: buildWorkflow(sessions, window),
		projects: buildProjects(sessions, window),
		lifecycle: buildLifecycle(sessions, window),
	};
}
