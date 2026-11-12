"use client";

import type {
	AgendaTaskRecord,
	AgendaTaskRunRecord,
	FactoryAgent,
	FactoryCheck,
	FactoryRunState,
	FactoryWorkflowRecipe,
} from "@cline/shared";
import { createSessionId } from "@cline/shared/browser";
import { ArrowUpRight, Plus, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFactoryPresets } from "@/hooks/use-factory-presets";
import { desktopClient } from "@/lib/desktop-client";
import { isReplayReviewQueued } from "@/lib/factory-attention";
import { FACTORY_COMPARE } from "@/lib/factory-copy";
import { acceptanceSummary } from "./factory-detail-evidence";

const MAX_VARIANTS = 4;
// The Hub's default list size, requested explicitly so truncation is detectable.
const RUN_REPLAY_LIST_LIMIT = 200;
const RECENT_COMPARISONS = 10;
const selectClass =
	"h-9 rounded-md border border-input bg-background px-3 text-sm";

type ModelSelection = { providerId: string; modelId?: string };
type Entry = {
	label: string;
	task: AgendaTaskRecord;
	run?: AgendaTaskRunRecord;
};
type Variant = { task: AgendaTaskRecord; runs: AgendaTaskRunRecord[] };
type ComparisonSummary = { id: string; createdAt: string };

/** This run's comparisons, newest first, from one bounded task listing. */
function recentComparisons(
	tasks: AgendaTaskRecord[],
	sourceRunId: string,
): ComparisonSummary[] {
	const created = new Map<string, string>();
	for (const task of tasks) {
		const replay = task.factory?.replay;
		if (replay?.sourceRunId !== sourceRunId) continue;
		const known = created.get(replay.comparisonId);
		if (!known || task.createdAt < known)
			created.set(replay.comparisonId, task.createdAt);
	}
	return [...created]
		.map(([id, createdAt]) => ({ id, createdAt }))
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

const ROLE_LABELS = {
	builder: "Implementer",
	reviewer: "Reviewer",
	verifier: "Verifier",
} as const;

// Mirrors core resolveFactoryAgent: role override, then the frozen profile,
// then the model saved in the run's input snapshot.
function agentModel(agent: FactoryAgent, fallback?: ModelSelection): string {
	const profile = agent.resolvedProfile;
	const selection =
		agent.modelSelection ??
		(profile?.providerId || profile?.modelId
			? {
					providerId: profile.providerId ?? fallback?.providerId ?? "cline",
					modelId: profile.modelId ?? fallback?.modelId,
				}
			: fallback);
	return selection
		? `${selection.providerId}/${selection.modelId || "default model"}`
		: "Unknown model";
}

function roleModels(state: FactoryRunState): string {
	const fallback = state.inputSnapshot?.modelSelection;
	const models = new Map<string, Set<string>>();
	const add = (role: keyof typeof ROLE_LABELS, agent: FactoryAgent) => {
		const label = ROLE_LABELS[role];
		models.set(
			label,
			(models.get(label) ?? new Set()).add(agentModel(agent, fallback)),
		);
	};
	// Attempts record the agents that actually ran; configuration is a fallback.
	const configured = !state.attempts?.length;
	if (!configured)
		for (const attempt of state.attempts ?? [])
			add(attempt.role, attempt.agent);
	else {
		const agents = state.agents ?? state.inputSnapshot?.factory.agents;
		for (const agent of agents?.implementers ?? []) add("builder", agent);
		for (const agent of agents?.reviewers ?? []) add("reviewer", agent);
		if (agents?.verifier) add("verifier", agents.verifier);
	}
	const text = [...models]
		.map(([role, names]) => `${role}: ${[...names].join(", ")}`)
		.join(" · ");
	return text ? `${text}${configured ? " (configured)" : ""}` : "Not recorded";
}

function elapsed(run: AgendaTaskRunRecord): string {
	const start = Date.parse(run.startedAt ?? run.claimedAt);
	const end = run.completedAt ? Date.parse(run.completedAt) : Number.NaN;
	if (!Number.isFinite(start)) return "Unknown";
	if (!Number.isFinite(end)) return "Not finished";
	const seconds = Math.max(0, Math.round((end - start) / 1000));
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	return hours
		? `${hours}h ${minutes}m`
		: minutes
			? `${minutes}m ${seconds % 60}s`
			: `${seconds}s`;
}

function entryStatus({ task, run }: Entry): string {
	if (run)
		return `${run.status.replaceAll("_", " ")}${run.factory ? ` · ${run.factory.phase}` : ""}`;
	if (isReplayReviewQueued(task)) return "Queued for plan review";
	const design =
		task.factoryDesignProgress?.revision === task.revision
			? task.factoryDesignProgress
			: undefined;
	if (design && design.phase !== "complete" && !task.error)
		return "Plan review in progress";
	return `Not run · ${task.status.replaceAll("_", " ")}`;
}

function workflowLabel(config: AgendaTaskRecord["factory"]): string {
	return config?.workflow
		? `${config.workflow.name} · ${config.workflow.revision.slice(0, 8)}`
		: "Original settings";
}

function checksKey(checks: FactoryCheck[] | undefined): string | undefined {
	return checks
		? JSON.stringify(checks.map((check) => [check.name, check.command]))
		: undefined;
}

const entryChecks = ({ task, run }: Entry) =>
	run?.factory?.inputSnapshot?.factory.checks ?? task.factory?.checks;
const entryBase = ({ task, run }: Entry) =>
	run?.factory?.workspace ?? task.factory?.replay;

function ComparisonTable({
	caption,
	entries,
	currentTaskId,
	onOpenTask,
}: {
	caption: string;
	entries: [Entry, ...Entry[]];
	currentTaskId: string;
	onOpenTask: (taskId: string) => void;
}) {
	const [source] = entries;
	const sourceBase = entryBase(source);
	const sourceChecks = checksKey(entryChecks(source));
	const usage =
		(render: (value: NonNullable<FactoryRunState["usage"]>) => string) =>
		({ run }: Entry) =>
			run?.factory?.usage ? render(run.factory.usage) : run ? "Unknown" : "—";
	const candidate =
		(render: (value: NonNullable<FactoryRunState["candidate"]>) => string) =>
		({ run }: Entry) =>
			run?.factory?.candidate ? render(run.factory.candidate) : "Not recorded";
	const rows: [string, (entry: Entry) => ReactNode][] = [
		["Status", entryStatus],
		[
			"Workflow",
			({ task, run }) =>
				workflowLabel(run?.factory?.inputSnapshot?.factory ?? task.factory),
		],
		["Runtime", () => "Cline"],
		["Models", ({ run }) => (run?.factory ? roleModels(run.factory) : "—")],
		[
			"Input / output tokens",
			usage(
				({ totals }) =>
					`${totals.inputTokens.toLocaleString()} / ${totals.outputTokens.toLocaleString()}`,
			),
		],
		[
			"Cache read / write tokens",
			usage(
				({ totals }) =>
					`${totals.cacheReadTokens.toLocaleString()} / ${totals.cacheWriteTokens.toLocaleString()}`,
			),
		],
		[
			"Recorded cost",
			usage(({ totals, unknownSessionIds }) => {
				const unknown = unknownSessionIds.length;
				return `$${totals.totalCost.toFixed(2)}${unknown ? ` + ${unknown} session${unknown === 1 ? "" : "s"} with unknown usage` : ""}`;
			}),
		],
		[
			"Accounting scope",
			({ task, run }) =>
				run?.factory
					? task.factory?.replay
						? "Plan review and execution sessions; no designer"
						: "Design and plan review sessions recorded for the task, plus execution"
					: "—",
		],
		["Elapsed", ({ run }) => (run ? elapsed(run) : "—")],
		[
			"Retries",
			({ run }) =>
				run?.factory
					? `Run attempt ${run.attempt} · ${(run.factory.attempts ?? []).filter((attempt) => attempt.status === "failed").length} failed agent attempts · ${run.factory.repairRound} repair rounds`
					: run
						? `Run attempt ${run.attempt}`
						: "—",
		],
		[
			"Automated checks",
			candidate(
				({ checks }) =>
					`${checks.filter((check) => check.status === "passed").length}/${checks.length} passed`,
			),
		],
		[
			"Agent reviews",
			candidate(
				({ reviews }) =>
					`${reviews.filter(({ review }) => review.verdict === "pass").length}/${reviews.length} passed`,
			),
		],
		[
			"Agent verification",
			candidate(({ verification }) =>
				verification
					? verification.review.verdict.replaceAll("_", " ")
					: "Not recorded",
			),
		],
		[
			"Acceptance criteria",
			({ run }) =>
				run?.factory
					? acceptanceSummary(
							run.factory.inputSnapshot?.factory.acceptanceCriteria,
							run.factory.candidate,
						)
					: "—",
		],
		[
			"Human check-off",
			({ run }) =>
				run?.factory?.humanApproval
					? `Checked off ${new Date(run.factory.humanApproval.approvedAt).toLocaleString()}`
					: run?.factory
						? "Not checked off"
						: "—",
		],
		[
			// Feedback is optional: nothing given shows nothing, never a request.
			"Feedback",
			({ run }) => {
				const audit = run?.factory?.audit;
				if (!audit?.reviewedAt) return "—";
				return audit.finding
					? `Something's off: ${audit.finding}`
					: "Looks good";
			},
		],
		[
			"Git base",
			(entry) => {
				const base = entryBase(entry);
				if (!base) return "Unknown";
				return `${base.baseBranch}@${base.baseCommit.slice(0, 12)}${entry === source || base.baseCommit === sourceBase?.baseCommit ? "" : " · differs from source"}`;
			},
		],
		[
			"Checks run",
			(entry) => {
				const checks = entryChecks(entry);
				if (!checks) return "Unknown";
				return `${checks.map((check) => check.name).join(", ") || "None"}${entry === source || checksKey(checks) === sourceChecks ? "" : " · differs from source"}`;
			},
		],
	];
	return (
		<div className="overflow-x-auto">
			<table className="w-full text-left text-xs">
				<caption className="p-2 text-left text-muted-foreground">
					{caption}
				</caption>
				<thead>
					<tr>
						<th className="p-2 font-medium">Variant</th>
						{entries.map((entry) => (
							<th
								key={`${entry.task.taskId}:${entry.run?.runId ?? "none"}`}
								className="min-w-40 p-2 align-top font-medium"
							>
								{entry.label}
								{entry.task.taskId === currentTaskId ? " (this task)" : ""}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map(([label, render]) => (
						<tr key={label} className="border-t">
							<th
								scope="row"
								className="p-2 align-top font-normal text-muted-foreground"
							>
								{label}
							</th>
							{entries.map((entry) => (
								<td
									key={`${entry.task.taskId}:${entry.run?.runId ?? "none"}`}
									className="break-words p-2 align-top"
								>
									{render(entry)}
								</td>
							))}
						</tr>
					))}
					<tr className="border-t">
						<th scope="row" className="p-2" />
						{entries.map((entry) => (
							<td
								key={`${entry.task.taskId}:${entry.run?.runId ?? "none"}`}
								className="space-y-1 p-2 align-top"
							>
								{entry.task.taskId !== currentTaskId ? (
									<Button
										size="sm"
										variant="outline"
										onClick={() => onOpenTask(entry.task.taskId)}
									>
										Open task <ArrowUpRight className="ml-1 size-3" />
									</Button>
								) : null}
							</td>
						))}
					</tr>
				</tbody>
			</table>
			<p className="p-2 text-xs text-muted-foreground">
				Tokens and cost add the sessions each run recorded (see Accounting
				scope). Replays reuse the source design and skip the designer, so these
				totals are not equivalent end-to-end costs.
			</p>
		</div>
	);
}

function ReplayForm({
	task,
	run,
	onCreated,
}: {
	task: AgendaTaskRecord;
	run: AgendaTaskRunRecord;
	onCreated: () => void;
}) {
	const { presets, loading, error: presetsError } = useFactoryPresets();
	const [variants, setVariants] = useState([
		{ label: "Original workflow", workflow: "" },
	]);
	// One ID per creation attempt: a retry after a failure reuses it so the Hub
	// returns already-created variants instead of duplicating them.
	const [comparisonId, setComparisonId] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const reviewMode = run.factory?.inputSnapshot?.factory.reviewMode ?? "fixed";
	const labels = variants.map((variant) => variant.label.trim());
	const invalid = labels.some((label) => !label || label.length > 100)
		? "Give every variant a label of up to 100 characters."
		: new Set(labels).size !== labels.length
			? "Variant labels must be unique."
			: null;
	const edit = (next: typeof variants) => {
		setVariants(next);
		setComparisonId(null);
	};
	async function create() {
		const id = comparisonId ?? createSessionId("comparison_");
		setComparisonId(id);
		setBusy(true);
		setError(null);
		try {
			await desktopClient.replayFactoryTask({
				taskId: task.taskId,
				runId: run.runId,
				comparisonId: id,
				variants: variants.map((variant) => {
					const preset = presets.find((item) => item.name === variant.workflow);
					const recipe: FactoryWorkflowRecipe | undefined = preset?.revision
						? {
								schemaVersion: 1,
								name: preset.name,
								revision: preset.revision,
								config: preset.config,
							}
						: undefined;
					return { label: variant.label.trim(), ...(recipe ? { recipe } : {}) };
				}),
			});
			setComparisonId(null);
			onCreated();
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Unable to create the comparison.",
			);
		} finally {
			setBusy(false);
		}
	}
	return (
		<div className="space-y-3 rounded-lg border p-3">
			<p className="text-xs leading-5 text-muted-foreground">
				Each variant becomes a normal Factory task with this run's saved brief,
				checks and Git base. A saved workflow changes only agents and limits; it
				must keep the original review mode. Creating the comparison starts each
				variant's fresh plan review when its workflow has plan reviewers. No
				variant implements anything until you approve it. Publishing is off.
			</p>
			{variants.map((variant, index) => (
				<div key={index} className="flex flex-wrap items-center gap-2">
					<Input
						aria-label={`Variant ${index + 1} label`}
						className="h-9 w-48"
						value={variant.label}
						disabled={busy}
						onChange={(event) =>
							edit(
								variants.map((item, itemIndex) =>
									itemIndex === index
										? { ...item, label: event.target.value }
										: item,
								),
							)
						}
					/>
					<select
						aria-label={`Variant ${index + 1} workflow`}
						className={selectClass}
						value={variant.workflow}
						disabled={busy || loading}
						onChange={(event) =>
							edit(
								variants.map((item, itemIndex) =>
									itemIndex === index
										? { ...item, workflow: event.target.value }
										: item,
								),
							)
						}
					>
						<option value="">Original workflow</option>
						{presets.map((preset) => {
							const differentMode =
								(preset.config.reviewMode ?? "fixed") !== reviewMode;
							return (
								<option
									key={preset.name}
									value={preset.name}
									disabled={!preset.revision || differentMode}
								>
									{preset.name}
									{preset.revision ? ` · ${preset.revision.slice(0, 8)}` : ""}
									{differentMode ? " (different review mode)" : ""}
								</option>
							);
						})}
					</select>
					{variants.length > 1 ? (
						<Button
							size="icon"
							variant="ghost"
							aria-label={`Remove variant ${index + 1}`}
							disabled={busy}
							onClick={() =>
								edit(variants.filter((_, itemIndex) => itemIndex !== index))
							}
						>
							<X className="size-4" />
						</Button>
					) : null}
				</div>
			))}
			{presetsError ? (
				<p className="text-xs text-destructive">
					Saved workflows could not be loaded: {presetsError}
				</p>
			) : null}
			{invalid || error ? (
				<p role="alert" className="text-xs text-destructive">
					{error ?? invalid}
				</p>
			) : null}
			<div className="flex flex-wrap gap-2">
				<Button
					size="sm"
					variant="ghost"
					disabled={busy || variants.length >= MAX_VARIANTS}
					onClick={() =>
						edit([
							...variants,
							{ label: `Variant ${variants.length + 1}`, workflow: "" },
						])
					}
				>
					<Plus className="mr-1 size-3.5" /> Add variant
				</Button>
				<Button
					size="sm"
					disabled={busy || Boolean(invalid)}
					onClick={() => void create()}
				>
					{busy
						? "Creating…"
						: comparisonId
							? "Retry creating comparison"
							: "Create comparison"}
				</Button>
			</div>
		</div>
	);
}

/**
 * Replay a recorded run under one to four workflows and compare the
 * resulting normal Factory tasks side by side. Shows one comparison at a time:
 * a replay task shows its own; a source run lists its recent comparisons once
 * and loads runs only for the chosen one (at most four tasks). Loads on open,
 * on Refresh and when another comparison is chosen.
 */
export function FactoryComparison({
	task,
	runs,
	defaultRunId,
	onOpenTask,
}: {
	task: AgendaTaskRecord;
	runs: AgendaTaskRunRecord[];
	defaultRunId: string | undefined;
	onOpenTask: (taskId: string) => void;
}) {
	const replay = task.factory?.replay;
	const [sourceRunId, setSourceRunId] = useState(
		replay?.sourceRunId ?? defaultRunId,
	);
	const [chosenComparisonId, setChosenComparisonId] = useState<string>();
	const [creating, setCreating] = useState(false);
	const [version, setVersion] = useState(0);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [loaded, setLoaded] = useState<{
		sourceRunId?: string;
		comparisonId?: string;
		comparisons: ComparisonSummary[];
		truncated: boolean;
		sourceTask?: AgendaTaskRecord;
		sourceRun?: AgendaTaskRunRecord;
		variants: Variant[];
	}>({ comparisons: [], truncated: false, variants: [] });
	const sourceTaskId = replay?.sourceTaskId;
	const replayComparisonId = replay?.comparisonId;
	// biome-ignore lint/correctness/useExhaustiveDependencies: version is the manual Refresh trigger.
	useEffect(() => {
		if (!sourceRunId) return;
		let active = true;
		setLoading(true);
		setError(null);
		void (async () => {
			const [source, listed] = await Promise.all([
				// A deleted source leaves nothing to compare against.
				sourceTaskId
					? desktopClient.getFactoryTask(sourceTaskId).catch(() => undefined)
					: undefined,
				replayComparisonId
					? undefined
					: desktopClient.listAgendaTasks({
							allWorkspaces: true,
							includeArchived: true,
							factoryReplaySourceRunId: sourceRunId,
							limit: RUN_REPLAY_LIST_LIMIT,
						}),
			]);
			const comparisons = listed
				? recentComparisons(listed, sourceRunId).slice(0, RECENT_COMPARISONS)
				: [];
			const comparisonId =
				replayComparisonId ??
				(
					comparisons.find(({ id }) => id === chosenComparisonId) ??
					comparisons[0]
				)?.id;
			// List the comparison itself so a truncated run listing can't hide variants.
			const tasks = comparisonId
				? await desktopClient.listAgendaTasks({
						allWorkspaces: true,
						includeArchived: true,
						factoryComparisonId: comparisonId,
					})
				: [];
			// Task IDs derive from the comparison and variant index, so at most four match.
			const matching = tasks.filter(
				(variant) =>
					variant.factory?.replay?.sourceRunId === sourceRunId &&
					variant.factory.replay.comparisonId === comparisonId,
			);
			const variants = await Promise.all(
				matching.map(async (variant) => ({
					task: variant,
					runs: (await desktopClient.getFactoryTask(variant.taskId)).runs ?? [],
				})),
			);
			if (!active) return;
			setLoaded({
				sourceRunId,
				comparisonId,
				comparisons,
				truncated: (listed?.length ?? 0) >= RUN_REPLAY_LIST_LIMIT,
				sourceTask: source?.task,
				sourceRun: source?.runs.find((run) => run.runId === sourceRunId),
				variants,
			});
		})()
			.catch((cause: unknown) => {
				if (active)
					setError(
						cause instanceof Error
							? cause.message
							: "Unable to load the comparison.",
					);
			})
			.finally(() => {
				if (active) setLoading(false);
			});
		return () => {
			active = false;
		};
	}, [
		sourceRunId,
		sourceTaskId,
		replayComparisonId,
		chosenComparisonId,
		version,
	]);

	const sourceTask = replay ? loaded.sourceTask : task;
	const sourceRun = replay
		? loaded.sourceRun
		: runs.find((run) => run.runId === sourceRunId);
	const current = loaded.sourceRunId === sourceRunId;
	const variants = current ? loaded.variants : [];
	const comparisons = current ? loaded.comparisons : [];
	const factoryRuns = runs.filter((run) => run.factory);
	return (
		<section
			aria-label="Workflow comparison"
			className="space-y-3 rounded-lg border bg-card px-5 py-4"
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 className="text-sm font-semibold">
					{replay
						? FACTORY_COMPARE.replayHeading(replay.label)
						: FACTORY_COMPARE.heading}
				</h3>
				<div className="flex flex-wrap gap-2">
					{!replay && !task.archivedAt ? (
						<Button
							size="sm"
							variant={creating ? "secondary" : "outline"}
							aria-expanded={creating}
							onClick={() => setCreating((value) => !value)}
						>
							{FACTORY_COMPARE.replay}
						</Button>
					) : null}
					<Button
						size="sm"
						variant="ghost"
						disabled={loading || !sourceRunId}
						onClick={() => setVersion((value) => value + 1)}
					>
						{loading ? "Refreshing…" : "Refresh"}
					</Button>
				</div>
			</div>
			<p className="text-xs text-muted-foreground">
				{FACTORY_COMPARE.explainer}
			</p>
			{!replay && factoryRuns.length > 1 ? (
				<label className="flex items-center gap-2 text-xs">
					{FACTORY_COMPARE.sourceRun}
					<select
						className={selectClass}
						value={sourceRunId}
						onChange={(event) => setSourceRunId(event.target.value)}
					>
						{factoryRuns.map((run) => (
							<option key={run.runId} value={run.runId}>
								{FACTORY_COMPARE.runOption(
									run.attempt,
									run.taskRevision,
									run.status.replaceAll("_", " "),
								)}
							</option>
						))}
					</select>
				</label>
			) : null}
			{creating && !replay && sourceRun ? (
				sourceRun.factory?.inputSnapshot ? (
					sourceRun.factory.inputSnapshot.factory.acceptanceCriteria?.length ? (
						<ReplayForm
							key={sourceRun.runId}
							task={task}
							run={sourceRun}
							onCreated={() => {
								setCreating(false);
								// Show the new comparison, which is now the most recent.
								setChosenComparisonId(undefined);
								setVersion((value) => value + 1);
							}}
						/>
					) : (
						<p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
							This run predates named acceptance criteria, so its variants would
							have no shared rubric. Rescope and run the work again before
							comparing workflows.
						</p>
					)
				) : (
					<p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
						This run was recorded before Factory saved its execution inputs, so
						it can't be replayed faithfully. Runs started from now on can be
						replayed.
					</p>
				)
			) : null}
			{comparisons.length > 1 ? (
				<label className="flex items-center gap-2 text-xs">
					Comparison
					<select
						className={selectClass}
						value={loaded.comparisonId}
						onChange={(event) => setChosenComparisonId(event.target.value)}
					>
						{comparisons.map((comparison) => (
							<option key={comparison.id} value={comparison.id}>
								Created {new Date(comparison.createdAt).toLocaleString()}
							</option>
						))}
					</select>
				</label>
			) : null}
			{current &&
			(comparisons.length >= RECENT_COMPARISONS || loaded.truncated) ? (
				<p className="text-xs text-muted-foreground">
					Lists up to the {RECENT_COMPARISONS} most recent comparisons of this
					run.
					{loaded.truncated
						? ` Discovery is limited to the ${RUN_REPLAY_LIST_LIMIT} most recent replay tasks.`
						: ""}
				</p>
			) : null}
			{error ? (
				<p role="alert" className="text-xs text-destructive">
					{error}
				</p>
			) : null}
			{replay && current && !loading && !error && !sourceTask ? (
				<p className="text-xs text-muted-foreground">
					The source task is unavailable (it may have been deleted), so this
					replay can't be compared with it.
				</p>
			) : null}
			{sourceTask && variants.length ? (
				<ComparisonTable
					caption={`Comparison created ${new Date(
						Math.min(
							...variants.map((variant) => Date.parse(variant.task.createdAt)),
						),
					).toLocaleString()}`}
					entries={[
						{ label: "Source", task: sourceTask, run: sourceRun },
						...[...variants]
							.sort(
								(a, b) =>
									(a.task.factory?.replay?.variantIndex ?? 0) -
									(b.task.factory?.replay?.variantIndex ?? 0),
							)
							.flatMap(({ task: variant, runs: variantRuns }) => {
								const label = variant.factory?.replay?.label ?? variant.title;
								const ordered = [...variantRuns].sort(
									(a, b) => a.attempt - b.attempt,
								);
								return ordered.length
									? ordered.map((run) => ({
											label:
												ordered.length > 1
													? `${label} · run ${run.attempt}`
													: label,
											task: variant,
											run,
										}))
									: [{ label, task: variant }];
							}),
					]}
					currentTaskId={task.taskId}
					onOpenTask={onOpenTask}
				/>
			) : null}
			{!loading && !error && current && variants.length === 0 ? (
				<p className="text-xs text-muted-foreground">{FACTORY_COMPARE.none}</p>
			) : null}
		</section>
	);
}
