/**
 * Entry-point routing for work that arrives with its plan. A card created
 * with a `factory.prepared` marker skips the designer and gets a quick check
 * instead: the deterministic validation, a screen of every supplied command
 * for unsafe shapes, and one capped plan reviewer. Nothing a plan supplies
 * runs before the plan is approved: its checks run once at the base commit as
 * the first step of the approved run. Anything that fails sends the card to
 * the designer with the plan as input, never to a person. The decision is
 * stored on the design progress as `route`.
 */
import { createHash } from "node:crypto";
import {
	FACTORY_REVIEW_SIZE_BOUNDS,
	type FactoryCheck,
	type FactoryDesignProgress,
	type FactoryDesignRoute,
	type FactoryTaskConfig,
	type FactoryWorkspace,
	factoryPreparedScopeProblems,
} from "@cline/shared";
import {
	CHECK_TIMEOUT_MS,
	factoryWorkspaceChanges,
	restoreFactoryWorktree,
	runFactoryShellCommand,
} from "./factory-local";
import { factoryUnsafeCommandProblems } from "./factory-verification-profile";

/** Overall time the base-commit run of a supplied plan's checks may take. */
const FACTORY_PREPARED_BASE_CAP_MS = 10 * 60_000;
/** The quick model check: one plan reviewer with small limits. */
export const FACTORY_PREPARED_SWEEP_LIMITS = {
	maxIterations: 20,
	timeoutSeconds: 300,
} as const;
/** Characters of a base-run check's output kept as its detail. */
const BASE_DETAIL_CHARS = 300;

type FactoryPreparedBase = NonNullable<FactoryDesignRoute["base"]>;

/** Digest of what a supplied plan consists of; an edit to any of it voids the skip. */
export function factoryPreparedDigest(
	instructions: string,
	config: Pick<FactoryTaskConfig, "checks" | "acceptanceCriteria" | "prepared">,
): string {
	return createHash("sha256")
		.update(
			JSON.stringify([
				instructions.trim(),
				config.checks,
				config.acceptanceCriteria ?? [],
				config.prepared?.paths ?? [],
			]),
		)
		.digest("hex");
}

/** Seals a new card's prepared marker with the engine's own digest. */
export function sealFactoryPreparedScope<T extends FactoryTaskConfig>(
	config: T,
	instructions: string,
): T {
	if (!config.prepared) return config;
	return {
		...config,
		prepared: {
			...config.prepared,
			digest: factoryPreparedDigest(instructions, config),
		},
	};
}

/**
 * Why a supplied plan cannot be used as it is (empty when it can): the
 * deterministic validation, and every check command screened for obviously
 * unsafe shapes. Nothing here runs a command.
 */
export function factoryPreparedPlanProblems(
	config: Pick<FactoryTaskConfig, "checks" | "acceptanceCriteria" | "replay">,
	workspaceRoot?: string,
): string[] {
	return [
		...factoryPreparedScopeProblems(config, workspaceRoot),
		...config.checks.flatMap((check) =>
			factoryUnsafeCommandProblems(check.command).map(
				(problem) => `Check "${check.name}" ${problem}.`,
			),
		),
	];
}

/**
 * The engine's size for a supplied plan: `local`, or `shared_contract` when it
 * lists more paths than a local change touches. Never `trivial`; the review
 * size policy and the post-build escalation apply as for a designer's rating.
 */
function factoryPreparedSize(
	paths: readonly string[],
): "local" | "shared_contract" {
	return paths.length > FACTORY_REVIEW_SIZE_BOUNDS.local.changedFiles
		? "shared_contract"
		: "local";
}

/** The review selection Factory writes for a supplied plan (adaptive review). */
export function factoryPreparedSelection(
	paths: string[],
	pools: { reviewers: number },
) {
	const size = factoryPreparedSize(paths);
	const reviewers = size === "local" ? 1 : 2;
	return {
		impact: size,
		size,
		rationale: `The plan came with the request; Factory rated its size from the ${paths.length} path${paths.length === 1 ? "" : "s"} it lists.`,
		affectedPaths: paths,
		consumers: [
			"Not analysed: the plan came with the request and no designer ran.",
		],
		planReviewerIndices: size === "local" ? [] : [0],
		reviewerIndices: Array.from(
			{ length: Math.max(1, Math.min(reviewers, pools.reviewers)) },
			(_, index) => index,
		),
	};
}

/** The designer's note when a supplied plan was not used, appended to its prompt. */
export function factoryPreparedDesignerNote(
	reason: string,
	paths: readonly string[] | undefined,
): string {
	return `The checks and acceptance criteria shown as the current proposal came with the request${paths?.length ? `, for these repository paths: ${JSON.stringify(paths)}` : ""}. Factory did not use them as they are: ${reason} Keep what is right in them, fix what this names, and return a complete plan.`;
}

/** The route after the supplied plan went to the designer. */
export function factoryPreparedFallback(
	route: FactoryDesignRoute | undefined,
	reason: string,
): FactoryDesignRoute {
	return {
		...route,
		scoping: "designer",
		reason: reason.slice(0, 4000),
	};
}

/**
 * One line for factory_status's `scope`, or undefined for an ordinary card:
 * "provided by agent; quick check passed".
 */
export function describeFactoryScopeRoute(
	progress: FactoryDesignProgress | undefined,
): string | undefined {
	const route = progress?.route;
	if (!route) return undefined;
	if (route.scoping === "none") return "not needed for a pull request review";
	const by = route.source ? ` by ${route.source}` : "";
	if (route.scoping === "designer")
		return `plan provided${by} was not used (${route.reason ?? "it did not pass the quick check"}); Factory scoped it`;
	// `checks` is only on cards scoped before every supplied plan got the model check.
	const level =
		progress.phase !== "complete"
			? "quick check running"
			: route.sweep === "checks"
				? "checked against the code only"
				: "quick check passed";
	return `provided${by}; ${level}`;
}

/**
 * The one capped plan reviewer's question for a supplied plan: only whether
 * it is wrong, incomplete or unsafe for this repository.
 */
export function factoryPreparedSweepPrompt(input: {
	/** The brief, as factoryBriefContext labels it. */
	brief: string;
	checks: unknown;
	acceptanceCriteria: unknown;
	route: FactoryDesignRoute;
}): string {
	return `Quick check of a plan that came with the request: Factory did not scope it and builds it as written. Answer one question: is this plan wrong, incomplete or unsafe for this repository? Read the code at the listed paths and what each check runs. None of the checks has run yet: once the plan is approved, each runs on the user's machine, as the user, first at the base commit and then on the change. Raise a finding only for a concrete defect: a check that cannot prove its criterion or would pass without the change, a criterion that misses what the brief asks, a path the change clearly needs that is not listed, a check command that does more than test this repository (network, credentials, files outside the repository, publishing), or a change that is unsafe here (secrets, data loss, auth, CI, dependencies). Do not redesign, polish or restate the plan; style and preferences are not findings. Keep it short: this pass has small iteration and time limits. Do not implement, modify files or publish, and do not run the checks. Return only JSON {"verdict":"pass"|"changes_requested","summary":"...","findings":["..."]}; pass requires no findings. Return that JSON as the final response.\n\n${input.brief}\n\nPATHS THE PLAN SAYS IT TOUCHES:\n${JSON.stringify(input.route.paths ?? [])}\n\nCHECKS:\n${JSON.stringify(input.checks)}\n\nACCEPTANCE CRITERIA:\n${JSON.stringify(input.acceptanceCriteria)}`;
}

function firstLine(text: string): string {
	const line =
		text
			.split(/\r?\n/)
			.map((entry) => entry.trim())
			.find(Boolean) ?? "no output";
	return line.length > BASE_DETAIL_CHARS
		? `${line.slice(0, BASE_DETAIL_CHARS - 1)}…`
		: line;
}

/**
 * Why an approved supplied plan does not build, from its base-commit run;
 * undefined when at least one check fails there (the plan proves a change).
 */
export function factoryPreparedBaseFallback(
	base: FactoryPreparedBase,
): string | undefined {
	if (base.outcome === "fails") return undefined;
	if (base.outcome === "all_pass")
		return "Every supplied check already passes at the base commit, so the plan proves no change.";
	const unrunnable = base.checks.find(
		(entry) => entry.status === "inconclusive",
	);
	return `A supplied check could not run at the base commit${unrunnable ? ` (${unrunnable.name}: ${unrunnable.detail ?? "no result"})` : ""}, so Factory cannot tell what it proves.`;
}

/**
 * Runs an approved supplied plan's checks once at the card's base commit, in
 * the run's worktree, as the first step of the run: before any builder
 * session and without a model, with only the allowlisted environment (as
 * repository stages run). Bounded by each check's time limit and `capMs`
 * overall. A check that cannot run (command not found or not executable,
 * killed, timed out) is inconclusive, neither passing nor failing. Call it
 * only before any build: the worktree is reset to the base commit before
 * and after, so a rerun after a restart is the same run.
 */
export async function runFactoryPreparedBaseChecks(input: {
	workspace: FactoryWorkspace;
	checks: readonly FactoryCheck[];
	signal: AbortSignal;
	capMs?: number;
}): Promise<FactoryPreparedBase> {
	const started = Date.now();
	const at = new Date(started).toISOString();
	const { checks, workspace } = input;
	const cap = input.capMs ?? FACTORY_PREPARED_BASE_CAP_MS;
	const result = (
		outcome: FactoryPreparedBase["outcome"],
		entries: FactoryPreparedBase["checks"],
		commit?: string,
	): FactoryPreparedBase => ({
		...(commit ? { commit } : {}),
		outcome,
		checks: entries,
		durationMs: Date.now() - started,
		at,
	});
	const inconclusive = (detail: string, commit?: string) =>
		result(
			"inconclusive",
			checks.map((check) => ({
				name: check.name,
				status: "inconclusive" as const,
				detail,
			})),
			commit,
		);
	try {
		// Nothing was built yet, so anything here is a leftover of an
		// interrupted base run.
		await restoreFactoryWorktree(workspace, input.signal, workspace.baseCommit);
		if (await factoryWorkspaceChanges(workspace, input.signal))
			return inconclusive(
				"The card's worktree could not be reset to its base commit.",
				workspace.baseCommit,
			);
	} catch (error) {
		input.signal.throwIfAborted();
		return inconclusive(
			`The worktree could not be reset to its base commit: ${firstLine(error instanceof Error ? error.message : String(error))}`,
			workspace.baseCommit,
		);
	}
	const entries: FactoryPreparedBase["checks"] = [];
	try {
		for (const check of checks) {
			const remaining = cap - (Date.now() - started);
			if (remaining <= 0) {
				entries.push({
					name: check.name,
					status: "inconclusive",
					detail: "Not run: the base-commit run reached its time limit.",
				});
				continue;
			}
			let run: Awaited<ReturnType<typeof runFactoryShellCommand>>;
			try {
				run = await runFactoryShellCommand({
					cwd: workspace.path,
					command: check.command,
					signal: input.signal,
					timeoutMs: Math.min(CHECK_TIMEOUT_MS, remaining),
					environment: "allowlisted",
				});
			} catch (error) {
				input.signal.throwIfAborted();
				entries.push({
					name: check.name,
					status: "inconclusive",
					detail: firstLine(
						error instanceof Error ? error.message : String(error),
					),
				});
				continue;
			}
			// 126 and 127: the shell could not execute or find the command.
			const unrunnable =
				run.timedOut ||
				run.exitCode === null ||
				run.exitCode === 126 ||
				run.exitCode === 127;
			const status = unrunnable
				? "inconclusive"
				: run.exitCode === 0
					? "passed"
					: "failed";
			entries.push({
				name: check.name,
				status,
				exitCode: run.exitCode,
				...(status === "passed"
					? {}
					: {
							detail: run.timedOut
								? "Timed out at the base commit."
								: firstLine(run.output),
						}),
			});
		}
	} finally {
		if (!input.signal.aborted)
			await restoreFactoryWorktree(
				workspace,
				input.signal,
				workspace.baseCommit,
			).catch(() => {});
	}
	return result(
		entries.some((entry) => entry.status === "inconclusive")
			? "inconclusive"
			: entries.every((entry) => entry.status === "passed")
				? "all_pass"
				: "fails",
		entries,
		workspace.baseCommit,
	);
}
