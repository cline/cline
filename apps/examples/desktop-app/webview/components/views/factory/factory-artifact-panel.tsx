"use client";

import type {
	AgendaTaskRecord,
	FactoryAttempt,
	FactoryCheckResult,
	FactoryPullRequestChecks,
	FactoryRunState,
	FactoryStageResult,
} from "@cline/shared";
import { factoryStageName } from "@cline/shared/browser";
import { ToolActivityCode } from "@cline/ui/components/agent-chat";
import {
	Check,
	CheckCircle2,
	ChevronDown,
	CircleAlert,
	Clock,
	Copy,
	GitBranch,
	XCircle,
} from "lucide-react";
import {
	type ComponentType,
	type KeyboardEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { desktopClient } from "@/lib/desktop-client";
import {
	FACTORY_CARD,
	FACTORY_PANEL,
	FACTORY_STAGES,
} from "@/lib/factory-copy";
import type { SessionFileDiff } from "@/lib/session-diff";
import { cn } from "@/lib/utils";
import { LOCAL_WORKSPACE_ENVIRONMENT_ID } from "@/lib/workspace-paths";
import { DiffView } from "../chat/diff-view";
import { CheckResultSummary, EvidencePreview } from "./factory-detail-evidence";
import type { FactoryLiveSession } from "./factory-live";
import { factoryFrozenModel } from "./factory-proof";
import type { FactoryStageKey } from "./factory-task-header";
import { type FactoryTone, StatusPill, toneText } from "./factory-ui";

export const FACTORY_PANEL_TABS = ["live", "changes", "checks", "pr"] as const;
export type FactoryPanelTab = (typeof FACTORY_PANEL_TABS)[number];

const isPanelTab = (value: unknown): value is FactoryPanelTab =>
	typeof value === "string" &&
	(FACTORY_PANEL_TABS as readonly string[]).includes(value);

/** The card state the panel's default tab depends on. */
export type FactoryPanelCard = {
	/** Agents are scoping, building, verifying or reviewing right now. */
	working: boolean;
	/** The result was handed over (draft PR or ready branch). */
	delivered: boolean;
	/** Core asked the user to review the delivered result. */
	needsReview: boolean;
	/** The run stopped with its draft PR open and review findings left. */
	openFindings: boolean;
	/** The work stopped (failed or blocked). */
	failed: boolean;
	/** A run has recorded evidence for this card. */
	hasRun: boolean;
};

/**
 * Which tab the panel opens on, from `factoryExecutionStage()` (undefined
 * before a run) and the card. Null hides the panel: hands-off work that has
 * not started has nothing to show.
 */
export function defaultFactoryPanelTab(
	stage: FactoryStageKey | undefined,
	card: FactoryPanelCard,
): FactoryPanelTab | null {
	if (card.openFindings || card.needsReview) return "changes";
	if (card.failed) return card.hasRun ? "checks" : null;
	if (card.delivered) return "changes";
	if (card.working) return "live";
	if (stage === "build" || stage === "verify" || stage === "review")
		return "live";
	if (stage === "deliver") return "changes";
	return card.hasRun ? "checks" : null;
}

const panelTabKey = (taskId: string) => `factory.panelTab.${taskId}`;

/**
 * The panel tab for a card: the user's choice, kept per card for the
 * session, wins over the default.
 */
export function useFactoryPanelTab(
	taskId: string,
	fallback: FactoryPanelTab | null,
): [FactoryPanelTab | null, (tab: FactoryPanelTab) => void] {
	const [chosen, setChosen] = useState<FactoryPanelTab | undefined>(() => {
		if (typeof window === "undefined") return undefined;
		const saved = sessionStorage.getItem(panelTabKey(taskId));
		return isPanelTab(saved) ? saved : undefined;
	});
	const choose = useCallback(
		(tab: FactoryPanelTab) => {
			setChosen(tab);
			sessionStorage.setItem(panelTabKey(taskId), tab);
		},
		[taskId],
	);
	return [fallback === null ? null : (chosen ?? fallback), choose];
}

/**
 * Below this card width the card is one column: the panel follows the
 * status, and on manual cards its tabs join the card's section tabs. From
 * here the card has two columns (a 300px main column beside the panel); it
 * matches the `@min-[700px]` container queries in factory-detail.tsx.
 */
export const FACTORY_NARROW_CARD = 700;

/**
 * Every role session known for the card, oldest first: the scoping agent,
 * the latest plan checkers, then the latest round of each execution role.
 * Finished sessions stay so their transcript can still be read.
 */
export function factoryKnownSessions({
	task,
	designSession,
	state,
}: {
	task: Pick<AgendaTaskRecord, "revision" | "factoryDesignProgress">;
	designSession: string | undefined;
	state: FactoryRunState | undefined;
}): FactoryLiveSession[] {
	const sessions: FactoryLiveSession[] = [];
	const seen = new Set<string>();
	const add = (session: FactoryLiveSession) => {
		if (seen.has(session.sessionId)) return;
		seen.add(session.sessionId);
		sessions.push(session);
	};
	if (designSession) add({ sessionId: designSession, role: "designer" });
	const progress = task.factoryDesignProgress;
	if (progress?.revision === task.revision && progress.phase !== "designing") {
		const latest = new Map<number, string>();
		for (const reviewer of progress.reviewerSessions)
			latest.set(reviewer.reviewerIndex, reviewer.sessionId);
		for (const sessionId of latest.values())
			add({ sessionId, role: "plan_reviewer" });
	}
	if (!state) return sessions;
	const attempts: readonly FactoryAttempt[] = state.attempts ?? [];
	if (attempts.length) {
		// A repository stage's session runs as a reviewer or builder; it is
		// its own lane, named by its stage.
		const lane = (attempt: FactoryAttempt) =>
			attempt.stageId ? `stage:${attempt.stageId}` : attempt.role;
		const latestRound = new Map<string, number>();
		for (const attempt of attempts)
			latestRound.set(
				lane(attempt),
				Math.max(latestRound.get(lane(attempt)) ?? 0, attempt.repairRound),
			);
		for (const attempt of attempts)
			if (attempt.repairRound === latestRound.get(lane(attempt))) {
				const model = factoryFrozenModel(
					attempt.agent,
					state.inputSnapshot?.modelSelection,
				);
				add({
					sessionId: attempt.sessionId,
					role: attempt.role,
					startedAt: attempt.createdAt,
					...("completedAt" in attempt ? { endedAt: attempt.completedAt } : {}),
					...(model ? { model } : {}),
					...(attempt.stageId
						? { stage: factoryStageName(state, attempt.stageId) }
						: {}),
				});
			}
	} else
		for (const session of state.sessions)
			add({ sessionId: session.sessionId, role: session.role });
	return sessions;
}

export type FactoryPanelSection = {
	value: string;
	label: string;
	icon?: ComponentType<{ className?: string }>;
	content: ReactNode;
};

const TAB_LABEL: Record<FactoryPanelTab, string> = FACTORY_PANEL.tabs;

/**
 * The card's artifact panel: Agents | Changes | Checks | PR. Inactive tabs are
 * unmounted, so each loads only when opened. On narrow cards the card's own
 * section tabs (`sections`) lead the same tab list.
 */
export function FactoryArtifactPanel({
	tab,
	onTabChange,
	panes,
	actions,
	sections,
	section,
	onSectionChange,
	onEscape,
	className,
}: {
	tab: FactoryPanelTab;
	onTabChange: (tab: FactoryPanelTab) => void;
	/** A tab without a pane is not shown. */
	panes: Partial<Record<FactoryPanelTab, ReactNode>>;
	/** Shown at the end of the tab bar, e.g. Refresh results. */
	actions?: ReactNode;
	/** Narrow cards: the card's section tabs, shown before the panel's. */
	sections?: FactoryPanelSection[];
	/** The selected section, or undefined while a panel tab is shown. */
	section?: string;
	onSectionChange?: (value: string) => void;
	/** Esc inside the panel: return focus to the card's left column. */
	onEscape?: () => void;
	className?: string;
}) {
	const merged = Boolean(sections?.length);
	const shownTabs = FACTORY_PANEL_TABS.filter((item) => item in panes);
	const value =
		merged && section && sections?.some((item) => item.value === section)
			? section
			: tab;
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		// Dialogs opened from the panel are portaled outside it.
		if (
			event.key !== "Escape" ||
			!onEscape ||
			!(event.target instanceof Node) ||
			!event.currentTarget.contains(event.target)
		)
			return;
		event.preventDefault();
		onEscape();
	};
	return (
		<Tabs
			value={value}
			onValueChange={(next) => {
				if (isPanelTab(next)) onTabChange(next);
				else onSectionChange?.(next);
			}}
			className={cn(
				"min-h-0 min-w-0 gap-0",
				merged ? "gap-5" : "overflow-hidden rounded-lg border bg-card",
				className,
			)}
			data-testid="factory-artifact-panel"
			onKeyDown={onKeyDown}
		>
			<div
				className={cn(
					"flex min-w-0 flex-wrap items-center justify-between gap-2",
					!merged && "border-b px-3 py-2",
				)}
			>
				<TabsList
					aria-label={merged ? "Task sections" : FACTORY_PANEL.label}
					className="max-w-full overflow-x-auto"
				>
					{sections?.map(({ value: sectionValue, label, icon: Icon }) => (
						<TabsTrigger key={sectionValue} value={sectionValue}>
							{Icon ? <Icon className="size-3.5" /> : null}
							{label}
						</TabsTrigger>
					))}
					{shownTabs.map((item) => (
						<TabsTrigger key={item} value={item}>
							{TAB_LABEL[item]}
						</TabsTrigger>
					))}
				</TabsList>
				{actions ? (
					<div className="flex shrink-0 items-center gap-2">{actions}</div>
				) : null}
			</div>
			{sections?.map((item) => (
				<TabsContent key={item.value} value={item.value} className="space-y-5">
					{item.content}
				</TabsContent>
			))}
			{shownTabs.map((item) => (
				<TabsContent
					key={item}
					value={item}
					className={cn(
						"min-h-0",
						item === "changes" || item === "live"
							? cn("flex flex-col", merged && "h-[70vh] rounded-lg border")
							: cn("space-y-4 overflow-y-auto", merged ? "" : "px-4 py-4"),
					)}
				>
					{panes[item]}
				</TabsContent>
			))}
		</Tabs>
	);
}

/**
 * The candidate's diff, fetched when this tab opens and only shown while it
 * still matches the run and commit it was asked for.
 */
export function FactoryChangesPane({
	taskId,
	runId,
	commit,
	workspacePath,
	branch,
	strip,
	note,
	onClose,
}: {
	taskId: string;
	runId: string | undefined;
	commit: string | undefined;
	workspacePath: string | undefined;
	branch: string | undefined;
	/** Findings shown above the diff. */
	strip?: ReactNode;
	note?: ReactNode;
	onClose: () => void;
}) {
	const [diff, setDiff] = useState<{
		runId: string | undefined;
		commit: string;
		files: SessionFileDiff[];
	} | null>(null);
	const [error, setError] = useState<string | null>(null);
	/** Fetches the diff; the returned function drops a superseded reply. */
	const load = useCallback(() => {
		if (!commit) return () => {};
		let active = true;
		setError(null);
		void desktopClient
			.invoke<SessionFileDiff[]>("factory_get_diff", {
				taskId,
				runId,
				expectedCommit: commit,
			})
			.then((files) => {
				if (active) setDiff({ runId, commit, files });
			})
			.catch((cause: unknown) => {
				if (active)
					setError(
						cause instanceof Error
							? cause.message
							: FACTORY_PANEL.changesFailed,
					);
			});
		return () => {
			active = false;
		};
	}, [taskId, runId, commit]);
	useEffect(() => load(), [load]);
	// A diff for an earlier run or commit is never shown as this one's.
	const files =
		diff && diff.runId === runId && diff.commit === commit ? diff.files : null;
	return (
		<>
			{branch || strip || note ? (
				<div className="space-y-3 border-b px-4 py-3">
					{branch ? (
						<div
							className="flex min-w-0 items-center gap-2 text-xs"
							data-testid="factory-changes-branch"
						>
							<GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
							<span className="sr-only">{FACTORY_CARD.branch}</span>
							<span className="min-w-0 truncate font-mono" title={branch}>
								{branch}
							</span>
							{commit ? (
								<span className="shrink-0 font-mono text-muted-foreground">
									{commit.slice(0, 7)}
								</span>
							) : null}
						</div>
					) : null}
					{note}
					{strip}
				</div>
			) : null}
			<div className="flex min-h-0 flex-1 flex-col">
				{!commit ? (
					<p className="p-4 text-sm text-muted-foreground">
						{FACTORY_PANEL.noCandidate}
					</p>
				) : error ? (
					<div className="space-y-2 p-4">
						<p role="alert" className="text-sm text-destructive">
							{error}
						</p>
						<Button size="sm" variant="outline" onClick={() => void load()}>
							{FACTORY_PANEL.reloadChanges}
						</Button>
					</div>
				) : files ? (
					<DiffView
						// The commit is beside the branch above.
						title={FACTORY_PANEL.changesTitle}
						environmentId={LOCAL_WORKSPACE_ENVIRONMENT_ID}
						cwd={workspacePath}
						fileDiffs={files}
						onClose={onClose}
					/>
				) : (
					<output className="block p-4 text-sm text-muted-foreground">
						{FACTORY_PANEL.loadingChanges}
					</output>
				)}
			</div>
		</>
	);
}

/**
 * Copies the worktree's absolute path. Shown under More → Details, not on
 * the Changes tab: the path lives in the user's profile and means little
 * beside the diff.
 */
export function FactoryCopyPathButton({ path }: { path: string }) {
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return;
		const timer = window.setTimeout(() => setCopied(false), 1600);
		return () => window.clearTimeout(timer);
	}, [copied]);
	return (
		<Button
			variant="ghost"
			size="sm"
			className="ml-auto h-6 shrink-0 px-2 text-xs text-muted-foreground"
			aria-label={FACTORY_CARD.copyWorktreePath}
			title={FACTORY_CARD.copyWorktreePath}
			onClick={() =>
				void navigator.clipboard
					?.writeText(path)
					.then(() => setCopied(true))
					.catch(() => undefined)
			}
		>
			{copied ? (
				<Check className="mr-1 size-3" />
			) : (
				<Copy className="mr-1 size-3" />
			)}
			{copied ? FACTORY_CARD.copiedWorktreePath : FACTORY_CARD.copyWorktreePath}
		</Button>
	);
}

/** One check: result, command, and its output in the tool-output block. */
/** Rule H: shows or hides a check's output in place. */
function OutputToggle({
	open,
	controls,
	onToggle,
	children,
}: {
	open: boolean;
	controls: string;
	onToggle: () => void;
	/** Follows the label, e.g. the exit code. */
	children: ReactNode;
}) {
	return (
		<Button
			variant="ghost"
			size="xs"
			className="mt-1 -ml-1.5 h-6 gap-1 px-1.5 text-xs text-muted-foreground has-[>svg]:px-1.5"
			aria-expanded={open}
			aria-controls={controls}
			onClick={onToggle}
		>
			<ChevronDown
				aria-hidden
				className={cn("size-3.5 transition-transform", open && "rotate-180")}
			/>
			{open ? FACTORY_PANEL.hideOutput : FACTORY_PANEL.showOutput}
			{children}
		</Button>
	);
}

export function FactoryCheckRow({
	check,
	taskId,
	runId,
	commit,
	onEditPlan,
}: {
	check: FactoryCheckResult;
	taskId: string;
	runId: string;
	commit: string | undefined;
	onEditPlan?: () => void;
}) {
	// Failed output is what the user came for; passing output stays folded.
	const [open, setOpen] = useState(check.status !== "passed");
	const outputId = useId();
	return (
		<li className="px-4 py-3">
			<CheckResultSummary check={check} onEditPlan={onEditPlan} />
			<code className="mt-1 block break-all text-xs text-muted-foreground">
				{check.command}
			</code>
			<OutputToggle
				open={open}
				controls={outputId}
				onToggle={() => setOpen((value) => !value)}
			>
				{check.exitCode !== null ? ` · exit ${check.exitCode}` : ""}
			</OutputToggle>
			{open ? (
				<ToolActivityCode
					id={outputId}
					aria-label={`${check.name} ${FACTORY_PANEL.output.toLowerCase()}`}
					className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-xs"
					data-testid="factory-check-output"
				>
					{check.output || FACTORY_PANEL.noOutput}
				</ToolActivityCode>
			) : null}
			{check.artifacts.map((artifact) => (
				<EvidencePreview
					key={`${runId}:${commit}:${artifact.path}`}
					taskId={taskId}
					runId={runId}
					artifact={artifact}
				/>
			))}
		</li>
	);
}

const STAGE_TONE: Record<FactoryStageResult["status"], FactoryTone> = {
	running: "neutral",
	passed: "success",
	failed: "danger",
	error: "attention",
	skipped: "neutral",
};

/**
 * Repository stages under the plan's checks: each result with its reason,
 * command and folded output, then stages that did not run because they are
 * not approved. Nothing when the run has neither.
 */
export function FactoryStageRows({
	stages,
	unapproved,
	taskId,
	runId,
	commit,
}: {
	stages: readonly FactoryStageResult[] | undefined;
	unapproved:
		| NonNullable<FactoryRunState["stagePlan"]>["unapproved"]
		| undefined;
	taskId: string;
	runId: string;
	commit: string | undefined;
}) {
	if (!stages?.length && !unapproved?.length) return null;
	return (
		<section
			aria-label={FACTORY_STAGES.heading}
			className="space-y-2"
			data-testid="factory-stage-rows"
		>
			<h4 className="text-sm font-semibold">{FACTORY_STAGES.heading}</h4>
			<ul className="divide-y rounded-lg border">
				{stages?.map((stage) => (
					<FactoryStageRow
						key={stage.id}
						stage={stage}
						taskId={taskId}
						runId={runId}
						commit={commit}
					/>
				))}
				{unapproved?.map((entry) => (
					<li
						key={entry.id ?? entry.name}
						className="flex items-start justify-between gap-2 px-4 py-3"
					>
						<div className="min-w-0 space-y-0.5">
							<p className="text-sm font-medium">{entry.name}</p>
							<p className="text-xs text-muted-foreground">{entry.reason}</p>
						</div>
						<StatusPill tone="neutral">
							{FACTORY_STAGES.trust.needs_approval}
						</StatusPill>
					</li>
				))}
			</ul>
		</section>
	);
}

function FactoryStageRow({
	stage,
	taskId,
	runId,
	commit,
}: {
	stage: FactoryStageResult;
	taskId: string;
	runId: string;
	commit: string | undefined;
}) {
	const detail = stage.output || stage.summary;
	const [open, setOpen] = useState(
		stage.status === "failed" || stage.status === "error",
	);
	const outputId = useId();
	const outcome =
		stage.access === "write" && stage.status === "passed"
			? FACTORY_STAGES.changed(stage.changedPaths?.length ?? 0)
			: FACTORY_STAGES.status[stage.status];
	return (
		<li className="px-4 py-3" data-status={stage.status}>
			<div className="flex items-start justify-between gap-2">
				<p className="min-w-0 break-words text-sm font-medium">{stage.name}</p>
				<StatusPill tone={STAGE_TONE[stage.status]}>{outcome}</StatusPill>
			</div>
			{stage.status === "skipped" ? (
				<p className="text-xs text-muted-foreground">
					{FACTORY_STAGES.skipped(stage.reason)}
				</p>
			) : stage.reason ? (
				<p className="break-words text-xs text-muted-foreground">
					{stage.reason}
					{stage.blocking ? "" : ` · ${FACTORY_STAGES.notBlocking}`}
				</p>
			) : null}
			{stage.command ? (
				<code className="mt-1 block break-all text-xs text-muted-foreground">
					{stage.command}
				</code>
			) : null}
			{stage.findings?.length ? (
				<ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
					{stage.findings.map((finding, index) => (
						<li key={`${index}-${finding}`} className="break-words">
							{finding}
						</li>
					))}
				</ul>
			) : null}
			{detail ? (
				<>
					<OutputToggle
						open={open}
						controls={outputId}
						onToggle={() => setOpen((value) => !value)}
					>
						{stage.exitCode !== undefined && stage.exitCode !== null
							? ` · exit ${stage.exitCode}`
							: ""}
					</OutputToggle>
					{open ? (
						<ToolActivityCode
							id={outputId}
							aria-label={`${stage.name} ${FACTORY_PANEL.output.toLowerCase()}`}
							className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-xs"
						>
							{detail}
						</ToolActivityCode>
					) : null}
				</>
			) : null}
			{stage.artifacts?.map((artifact) => (
				<EvidencePreview
					key={`${runId}:${commit}:${artifact.path}`}
					taskId={taskId}
					runId={runId}
					artifact={artifact}
				/>
			))}
		</li>
	);
}

const CI_STYLE: Record<
	FactoryPullRequestChecks["status"],
	{ tone: FactoryTone; icon: ComponentType<{ className?: string }> }
> = {
	passed: { tone: "success", icon: CheckCircle2 },
	pending: { tone: "working", icon: Clock },
	failed: { tone: "danger", icon: XCircle },
	unknown: { tone: "neutral", icon: CircleAlert },
};

/** CI on the draft PR for its current head. */
export function FactoryCiStatus({
	checks,
}: {
	checks: FactoryPullRequestChecks;
}) {
	const style = CI_STYLE[checks.status];
	return (
		<section aria-label={FACTORY_PANEL.ciHeading} className="space-y-2">
			<div className="flex items-center justify-between gap-2">
				<h4 className="text-sm font-semibold">{FACTORY_PANEL.ciHeading}</h4>
				<StatusPill tone={style.tone} icon={style.icon}>
					{FACTORY_PANEL.ciStatus[checks.status]}
				</StatusPill>
			</div>
			{checks.checks.length ? (
				<ul className="divide-y rounded-lg border text-sm">
					{checks.checks.map((check, index) => (
						<li
							key={`${check.name}-${index}`}
							className="flex items-center justify-between gap-3 px-3 py-2"
						>
							<span className="min-w-0 truncate">{check.name}</span>
							<span
								className={cn(
									"shrink-0 text-xs",
									toneText(
										check.status === "pass"
											? "success"
											: check.status === "fail"
												? "danger"
												: "neutral",
									),
								)}
							>
								{check.status}
							</span>
						</li>
					))}
				</ul>
			) : null}
		</section>
	);
}
