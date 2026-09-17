"use client";

import { RefreshCw, Share2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useUsagePatterns } from "@/hooks/use-usage";
import {
	type CombinedPatterns,
	type SourcePatterns,
	type SpanPattern,
	USAGE_SOURCE_LABELS,
	type UsageSourceId,
} from "@/lib/usage-types";
import { PageFrame, PageHeader } from "../page-layout";
import { UsageShareDialog } from "./usage-share-dialog";

type RangeDays = 7 | 30 | 90;
type SourceFilter = UsageSourceId | "all";
/** What every chart on the page reads: the combined view or one source. */
type PatternView = CombinedPatterns;

const RANGE_OPTIONS: RangeDays[] = [7, 30, 90];
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** The 24 local hours; charts key their cells by the hour itself. */
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const SOURCE_FILTERS: SourceFilter[] = ["all", "cline", "codex", "claude-code"];
const MS_PER_DAY = 86_400_000;

const EMPTY_VIEW: PatternView = {
	rhythm: {
		hourHistogram: Array.from({ length: 24 }, () => 0),
		weekdayHourMatrix: Array.from({ length: 7 }, () =>
			Array.from({ length: 24 }, () => 0),
		),
		daily: [],
		activeDays: 0,
		firstActiveMs: null,
		currentStreakDays: 0,
		longestStreakDays: 0,
		peakHour: null,
		nightShare: 0,
	},
	workflow: {
		sessions: 0,
		rootSessions: 0,
		subagentSessions: 0,
		orchestrationShare: 0,
		maxDepth: 0,
		depthHistogram: {},
	},
	projects: [],
	lifecycle: { terminalSessions: 0, failedSessions: 0 },
};

function compactNumber(value: number): string {
	if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
	return String(Math.round(value));
}

function percent(value: number): string {
	return `${Math.round(value * 100)}%`;
}

function shortDate(ms: number | null, withYear = false): string {
	if (ms == null) return "—";
	return new Date(ms).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		...(withYear ? { year: "numeric" } : {}),
	});
}

function hourLabel(hour: number): string {
	return `${String(hour).padStart(2, "0")}:00`;
}

function StatCard({
	hint,
	label,
	value,
}: {
	hint?: string;
	label: string;
	value: string;
}) {
	return (
		<div className="rounded-lg border bg-card p-4">
			<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
				{label}
			</p>
			<p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
			{hint ? (
				<p className="mt-1 text-xs text-muted-foreground">{hint}</p>
			) : null}
		</div>
	);
}

/** Weekday x hour activity heatmap (Monday-first rows). */
function HourHeatmap({ matrix }: { matrix: number[][] }) {
	const max = Math.max(1, ...matrix.flat());
	return (
		<div className="flex flex-col gap-1">
			{matrix.map((row, weekday) => (
				<div className="flex items-center gap-2" key={WEEKDAY_LABELS[weekday]}>
					<span className="w-8 shrink-0 text-right text-[10px] text-muted-foreground">
						{WEEKDAY_LABELS[weekday]}
					</span>
					<div className="flex flex-1 gap-[2px]">
						{HOURS.map((hour) => {
							const count = row[hour] ?? 0;
							return (
								<div
									className="h-4 flex-1 rounded-[2px]"
									key={hour}
									style={{
										backgroundColor:
											count === 0
												? "var(--surface-hover, rgba(127,127,127,0.12))"
												: `color-mix(in oklab, var(--primary, #4f8cff) ${Math.max(
														12,
														Math.round((count / max) * 100),
													)}%, transparent)`,
									}}
									title={`${WEEKDAY_LABELS[weekday]} ${hourLabel(hour)} — ${count}`}
								/>
							);
						})}
					</div>
				</div>
			))}
			<div className="flex items-center gap-2">
				<span className="w-8 shrink-0" />
				<div className="flex flex-1 gap-[2px]">
					{HOURS.map((hour) => (
						<span
							className="flex-1 text-center text-[9px] text-muted-foreground"
							key={hour}
						>
							{hour % 3 === 0 ? hour : ""}
						</span>
					))}
				</div>
			</div>
		</div>
	);
}

/** Vertical columns for a 24-slot hour histogram, with hour axis labels. */
function HourColumns({ values }: { values: number[] }) {
	const max = Math.max(1, ...values);
	return (
		<div className="flex flex-col gap-1">
			<div className="flex h-24 items-end gap-[2px]">
				{HOURS.map((hour) => {
					const count = values[hour] ?? 0;
					return (
						<div
							className="flex-1 rounded-t-[2px] bg-primary/70"
							key={hour}
							style={{ height: `${Math.max(2, (count / max) * 100)}%` }}
							title={`${hourLabel(hour)} — ${count}`}
						/>
					);
				})}
			</div>
			<div className="flex gap-[2px]">
				{HOURS.map((hour) => (
					<span
						className="flex-1 text-center text-[9px] text-muted-foreground"
						key={hour}
					>
						{hour % 6 === 0 ? hour : ""}
					</span>
				))}
			</div>
		</div>
	);
}

/**
 * Horizontal bars. `secondary` draws the subagent portion of each bar, so a
 * project row shows how much of its work was orchestrated.
 */
function BarList({
	entries,
	max,
}: {
	entries: Array<{ label: string; value: number; secondary?: number }>;
	max: number;
}) {
	return (
		<div className="flex flex-col gap-2">
			{entries.map((entry) => {
				const sub = Math.min(entry.secondary ?? 0, entry.value);
				const root = entry.value - sub;
				return (
					<div className="flex items-center gap-3" key={entry.label}>
						<span
							className="w-40 shrink-0 truncate text-xs text-muted-foreground"
							title={entry.label}
						>
							{entry.label}
						</span>
						<div className="flex h-2 flex-1 overflow-hidden rounded-full bg-surface-hover">
							<div
								className="h-full bg-primary/80"
								style={{ width: `${max === 0 ? 0 : (root / max) * 100}%` }}
							/>
							<div
								className="h-full bg-primary/35"
								style={{ width: `${max === 0 ? 0 : (sub / max) * 100}%` }}
							/>
						</div>
						<span className="w-10 shrink-0 text-right text-xs tabular-nums text-foreground">
							{compactNumber(entry.value)}
						</span>
					</div>
				);
			})}
		</div>
	);
}

/** Span buckets, light to heavy, shared by the legend and every bar. */
const SPAN_BUCKETS = [
	{ key: "under10m", label: "< 10m", className: "bg-primary/30" },
	{ key: "under1h", label: "10m-1h", className: "bg-primary/55" },
	{ key: "under4h", label: "1-4h", className: "bg-primary/80" },
	{ key: "under24h", label: "4-24h", className: "bg-sky-500/70" },
	{ key: "over24h", label: "> 24h", className: "bg-amber-500/80" },
] as const satisfies ReadonlyArray<{
	key: keyof SpanPattern["buckets"];
	label: string;
	className: string;
}>;

/**
 * One legend for every bar. Items never wrap mid-entry: a fixed-column grid
 * squeezed the labels and their numbers onto separate lines.
 */
function SpanLegend() {
	return (
		<ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
			{SPAN_BUCKETS.map((bucket) => (
				<li
					className="flex items-center gap-1.5 whitespace-nowrap"
					data-testid="span-legend-item"
					key={bucket.key}
				>
					<span className={`size-2 rounded-full ${bucket.className}`} />
					{bucket.label}
				</li>
			))}
		</ul>
	);
}

/**
 * One source's span distribution as a single 100% bar.
 *
 * Bars stay per source because the stores measure differently: Codex closes
 * short rollout files while Claude Code appends to one transcript across
 * resumes, so summing them would mix incomparable spans.
 */
function SpanSourceRow({
	buckets,
	name,
	rootSessions,
	showCounts,
}: {
	buckets: SpanPattern["buckets"];
	name: string;
	rootSessions: number;
	showCounts: boolean;
}) {
	const total = SPAN_BUCKETS.reduce(
		(sum, bucket) => sum + buckets[bucket.key],
		0,
	);
	return (
		<div className="flex flex-col gap-2" data-testid="span-source-row">
			<div className="flex items-center gap-3">
				<span
					className="w-24 shrink-0 truncate text-xs font-medium text-foreground"
					title={name}
				>
					{name}
				</span>
				<div className="flex h-3 flex-1 overflow-hidden rounded-full bg-surface-hover">
					{total === 0
						? null
						: SPAN_BUCKETS.map((bucket) => (
								<div
									className={bucket.className}
									key={bucket.key}
									style={{ width: `${(buckets[bucket.key] / total) * 100}%` }}
									title={`${bucket.label}: ${buckets[bucket.key]}`}
								/>
							))}
				</div>
				<span className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
					{compactNumber(rootSessions)}
				</span>
			</div>
			{showCounts && total > 0 ? (
				<ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
					{SPAN_BUCKETS.map((bucket) => (
						<li className="whitespace-nowrap" key={bucket.key}>
							<span className="font-medium text-foreground">
								{buckets[bucket.key]}
							</span>{" "}
							{bucket.label} · {Math.round((buckets[bucket.key] / total) * 100)}
							%
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
}

/** Local YYYY-MM-DD key, matching the core's day bucketing. */
function dayKey(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
		date.getDate(),
	).padStart(2, "0")}`;
}

/**
 * Root sessions started on every calendar day of the window, so inactive days
 * read as zero instead of being bridged by a straight line. Days are stepped
 * on the calendar, not in 24-hour jumps, so a DST change never skips one.
 */
function fillDailyGaps(
	points: Array<{ date: string; started: number }>,
	rangeDays: number,
	nowMs: number,
): Array<{ date: string; started: number }> {
	const byDate = new Map(points.map((point) => [point.date, point.started]));
	const today = new Date(nowMs);
	const out: Array<{ date: string; started: number }> = [];
	for (let offset = rangeDays - 1; offset >= 0; offset -= 1) {
		const key = dayKey(
			new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset),
		);
		out.push({ date: key, started: byDate.get(key) ?? 0 });
	}
	return out;
}

/** Daily root-session area chart with inactive days drawn as zero. */
function TrendArea({
	activeDays,
	points,
	rangeDays,
	nowMs,
}: {
	activeDays: number;
	points: Array<{ date: string; started: number }>;
	rangeDays: number;
	nowMs: number;
}) {
	const series = fillDailyGaps(points, rangeDays, nowMs);
	const max = Math.max(1, ...series.map((point) => point.started));
	const step = series.length > 1 ? 100 / (series.length - 1) : 100;
	const line = series
		.map((point, index) => `${index * step},${40 - (point.started / max) * 36}`)
		.join(" ");
	return (
		<div className="flex flex-col gap-1">
			<svg
				aria-label="Root sessions started per day"
				className="h-24 w-full"
				preserveAspectRatio="none"
				role="img"
				viewBox="0 0 100 40"
			>
				<title>Root sessions started per day</title>
				<polygon className="fill-primary/15" points={`0,40 ${line} 100,40`} />
				<polyline
					className="fill-none stroke-primary"
					points={line}
					strokeWidth="1"
					vectorEffect="non-scaling-stroke"
				/>
			</svg>
			<div className="flex justify-between text-[10px] text-muted-foreground">
				<span>{series[0]?.date}</span>
				<span>
					{activeDays} active of {rangeDays} days · peak {max}/day
				</span>
				<span>{series[series.length - 1]?.date}</span>
			</div>
		</div>
	);
}

function SectionCard({
	children,
	subtitle,
	title,
}: {
	children: React.ReactNode;
	subtitle?: string;
	title: string;
}) {
	return (
		<section className="rounded-lg border bg-card p-4">
			<header className="mb-3">
				<h3 className="text-sm font-semibold text-foreground">{title}</h3>
				{subtitle ? (
					<p className="text-xs text-muted-foreground">{subtitle}</p>
				) : null}
			</header>
			{children}
		</section>
	);
}

/** What a source's store holds and what the scan could not read. */
function sourceDetail(
	source: SourcePatterns,
	rangeDays: number,
	generatedAtMs: number,
): string {
	const { availability } = source;
	if (!availability.installed) return availability.note ?? "not detected";
	const parts = [`${compactNumber(source.workflow.sessions)} sessions`];
	const oldest = availability.coverage.oldestSessionMs;
	if (oldest != null) {
		const shorterThanWindow = oldest > generatedAtMs - rangeDays * MS_PER_DAY;
		parts.push(
			`history since ${shortDate(oldest, true)}${
				shorterThanWindow ? ` (shorter than ${rangeDays} days)` : ""
			}`,
		);
	}
	const skipped = Object.values(availability.coverage.skipped).reduce(
		(sum, count) => sum + count,
		0,
	);
	if (skipped > 0) {
		parts.push(`${skipped} file${skipped === 1 ? "" : "s"} skipped`);
	}
	if (availability.note) parts.push(availability.note);
	if (availability.root) parts.push(availability.root);
	return parts.join(" · ");
}

export function UsageContent() {
	const [rangeDays, setRangeDays] = useState<RangeDays>(30);
	const [filter, setFilter] = useState<SourceFilter>("all");
	const [shareOpen, setShareOpen] = useState(false);
	const { report, error, loading, refreshing, refresh } =
		useUsagePatterns(rangeDays);

	const sources = useMemo(() => report?.sources ?? [], [report]);
	const view: PatternView = useMemo(() => {
		if (!report) return EMPTY_VIEW;
		if (filter === "all") return report.combined;
		return (
			report.sources.find((source) => source.availability.source === filter) ??
			EMPTY_VIEW
		);
	}, [filter, report]);
	const spanRows = useMemo(
		() =>
			sources
				.filter(
					(source) =>
						(filter === "all"
							? source.availability.installed
							: source.availability.source === filter) &&
						source.workflow.rootSessions > 0,
				)
				.map((source) => ({
					name: USAGE_SOURCE_LABELS[source.availability.source],
					buckets: source.span.buckets,
					rootSessions: source.workflow.rootSessions,
				})),
		[filter, sources],
	);
	const { rhythm, workflow, lifecycle } = view;
	const hasAnySession = workflow.sessions > 0;
	const canShare = (report?.combined.workflow.sessions ?? 0) > 0;
	const depthRecorded = Object.keys(workflow.depthHistogram).length > 0;

	return (
		<PageFrame>
			<PageHeader
				actions={
					<div className="flex items-center gap-2">
						<Button
							disabled={!canShare}
							onClick={() => setShareOpen(true)}
							size="sm"
							title={
								canShare
									? "Export a privacy-safe image of your usage profile"
									: "Nothing to share in this window yet"
							}
							type="button"
							variant="outline"
						>
							<Share2 className="size-4" />
							Share
						</Button>
						<div className="flex overflow-hidden rounded-md border">
							{RANGE_OPTIONS.map((option) => (
								<Button
									className="rounded-none border-0"
									key={option}
									onClick={() => setRangeDays(option)}
									size="sm"
									type="button"
									variant={rangeDays === option ? "secondary" : "ghost"}
								>
									{option}d
								</Button>
							))}
						</div>
						<Button
							disabled={refreshing || loading}
							onClick={refresh}
							size="sm"
							type="button"
							variant="outline"
						>
							<RefreshCw
								className={refreshing ? "size-4 animate-spin" : "size-4"}
							/>
							Refresh
						</Button>
					</div>
				}
				description="How you drive the agents on this machine — Codex, Claude Code and Cline: rhythm, workflow style, project mix and orchestration. Read from on-disk session metadata only, so nothing leaves this machine."
				title="Usage"
			/>

			<div className="flex flex-col gap-5">
				<div className="flex flex-wrap items-center gap-2">
					{SOURCE_FILTERS.map((option) => {
						const label =
							option === "all" ? "All agents" : USAGE_SOURCE_LABELS[option];
						const source = sources.find(
							(entry) => entry.availability.source === option,
						);
						const disabled =
							option !== "all" && source?.availability.installed === false;
						return (
							<Button
								disabled={disabled}
								key={option}
								onClick={() => setFilter(option)}
								size="sm"
								title={
									disabled
										? `${label} was not found on this machine`
										: undefined
								}
								type="button"
								variant={filter === option ? "secondary" : "ghost"}
							>
								{disabled ? `${label} (not installed)` : label}
							</Button>
						);
					})}
					<span className="ml-auto text-xs text-muted-foreground">
						{loading
							? "Scanning local session stores…"
							: report
								? `${compactNumber(workflow.sessions)} sessions · updated ${new Date(
										report.generatedAtMs,
									).toLocaleTimeString(undefined, {
										hour: "2-digit",
										minute: "2-digit",
									})}`
								: null}
					</span>
				</div>

				{error ? (
					<p
						className="rounded-md border border-destructive/40 p-3 text-sm text-destructive"
						role="alert"
					>
						Couldn't read local usage: {error}
					</p>
				) : null}

				{!loading && !hasAnySession && !error ? (
					<p className="rounded-md border p-4 text-sm text-muted-foreground">
						No sessions found in the last {rangeDays} days.
						{sources.some((source) => !source.availability.installed)
							? " Some agents were not detected on this machine."
							: ""}
					</p>
				) : null}

				<div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
					<StatCard
						hint={`${compactNumber(workflow.subagentSessions)} subagent runs`}
						label="Sessions started"
						value={compactNumber(workflow.rootSessions)}
					/>
					<StatCard
						hint={`since ${shortDate(rhythm.firstActiveMs)}`}
						label="Active days"
						value={String(rhythm.activeDays)}
					/>
					<StatCard
						hint={`longest ${rhythm.longestStreakDays}d`}
						label="Current streak"
						value={`${rhythm.currentStreakDays}d`}
					/>
					<StatCard
						hint={
							rhythm.peakHour == null
								? undefined
								: `peak ${hourLabel(rhythm.peakHour)}`
						}
						label="Night share"
						value={percent(rhythm.nightShare)}
					/>
					<StatCard
						hint={
							depthRecorded
								? `max depth ${workflow.maxDepth}`
								: `${compactNumber(workflow.subagentSessions)} of ${compactNumber(workflow.sessions)} sessions`
						}
						label="Orchestration"
						value={percent(workflow.orchestrationShare)}
					/>
				</div>

				<SectionCard
					subtitle="When you start sessions, by weekday and hour (local time). Subagent runs are left out: they arrive in bursts that describe the tool, not your day."
					title="Activity rhythm"
				>
					<HourHeatmap matrix={rhythm.weekdayHourMatrix} />
				</SectionCard>

				<div className="grid gap-4 lg:grid-cols-2">
					<SectionCard
						subtitle="Sessions started per hour."
						title="Hour of day"
					>
						<HourColumns values={rhythm.hourHistogram} />
					</SectionCard>
					<SectionCard subtitle="Sessions started per day." title="Trend">
						<TrendArea
							activeDays={rhythm.activeDays}
							nowMs={report?.generatedAtMs ?? Date.now()}
							points={rhythm.daily}
							rangeDays={rangeDays}
						/>
					</SectionCard>
				</div>

				<SectionCard
					subtitle={`${compactNumber(workflow.subagentSessions)} subagent runs of ${compactNumber(workflow.sessions)} sessions${
						depthRecorded ? `; max fan-out depth ${workflow.maxDepth}` : ""
					}.`}
					title="Orchestration"
				>
					{depthRecorded ? (
						<BarList
							entries={Object.entries(workflow.depthHistogram).map(
								([depth, count]) => ({
									label: Number(depth) === 0 ? "root" : `depth ${depth}`,
									value: count,
								}),
							)}
							max={Math.max(...Object.values(workflow.depthHistogram))}
						/>
					) : (
						<p className="text-xs text-muted-foreground">
							{workflow.subagentSessions === 0
								? "No subagent runs in this window."
								: "Nesting depth is only recorded by Codex."}
						</p>
					)}
				</SectionCard>

				<div className="flex flex-col gap-4">
					<SectionCard
						subtitle="Sessions per project (last two path segments)."
						title="Where the work goes"
					>
						{view.projects.length === 0 ? (
							<p className="text-xs text-muted-foreground">
								No project paths recorded.
							</p>
						) : (
							<BarList
								entries={view.projects.slice(0, 8).map((project) => ({
									label: project.project,
									value: project.sessions,
									secondary: project.subagentSessions,
								}))}
								max={view.projects[0]?.sessions ?? 1}
							/>
						)}
					</SectionCard>
					<SectionCard
						subtitle="How long each root session stayed open — first recorded event to last local activity."
						title="Session span"
					>
						<div className="flex flex-col gap-4">
							<SpanLegend />
							{spanRows.length === 0 ? (
								<p className="text-xs text-muted-foreground">
									No root sessions in this window.
								</p>
							) : (
								<div className="flex flex-col gap-4">
									{spanRows.map((row) => (
										<SpanSourceRow
											buckets={row.buckets}
											key={row.name}
											name={row.name}
											rootSessions={row.rootSessions}
											showCounts={spanRows.length === 1}
										/>
									))}
								</div>
							)}
							<p className="text-xs text-muted-foreground">
								Span includes idle gaps, and the stores measure it differently:
								Claude Code keeps appending to one transcript when you resume,
								so its spans mostly show how long a conversation stayed open,
								while Codex writes short rollouts. Compare shapes within a
								source, never across sources — which is why the bars are per
								source instead of summed.
							</p>
							<p className="text-xs text-muted-foreground">
								{lifecycle.terminalSessions === 0
									? "Failed or aborted sessions: no finished session in this selection reports an outcome."
									: `${lifecycle.failedSessions} of ${lifecycle.terminalSessions} finished sessions that report an outcome ended failed or aborted (${Math.round(
											(lifecycle.failedSessions / lifecycle.terminalSessions) *
												100,
										)}%).`}
							</p>
						</div>
					</SectionCard>
				</div>

				<SectionCard
					subtitle="Detected sources, how far back their history goes, and their local roots."
					title="Sources"
				>
					<ul className="flex flex-col gap-2 text-xs">
						{sources.map((source) => (
							<li
								className="flex items-center gap-2"
								key={source.availability.source}
							>
								<span
									className={
										source.availability.installed
											? "size-2 shrink-0 rounded-full bg-primary"
											: "size-2 shrink-0 rounded-full bg-muted-foreground/40"
									}
								/>
								<span className="font-medium text-foreground">
									{USAGE_SOURCE_LABELS[source.availability.source]}
								</span>
								<span
									className="truncate text-muted-foreground"
									title={source.availability.root}
								>
									{sourceDetail(
										source,
										rangeDays,
										report?.generatedAtMs ?? Date.now(),
									)}
								</span>
							</li>
						))}
					</ul>
				</SectionCard>

				<p className="text-xs text-muted-foreground">
					Patterns describe structure and timing only — never prompt content,
					and never a cost estimate. Raw workload is not subscription billing,
					so this page shows how you work rather than what it cost.
				</p>
			</div>

			{shareOpen && report ? (
				<UsageShareDialog onOpenChange={setShareOpen} report={report} />
			) : null}
		</PageFrame>
	);
}
