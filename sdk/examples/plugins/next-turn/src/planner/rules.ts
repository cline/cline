import { SET_SIZE } from "../config";
import { isPresent, type Manifest } from "../context/manifest";
import { type Backlog, rankTasks, TASK_STATUSES } from "./backlog";
import {
	cleanEditReview,
	commitRow,
	planRow,
	type Suggestion,
	suggestion,
	type TurnFacts,
	turnLead,
	turnTail,
	uniqueByPrompt,
} from "./candidates";
import { offersKind } from "./kinds";

/**
 * The rule-based set: one rule set for every host, merged from the
 * backlog ranking and the turn-and-repo pool. It costs
 * nothing, so it is the set `afterRun` writes at once, what the model set is
 * topped up from, and the answer whenever the model cannot be asked.
 *
 * Only present sources contribute:
 * - **status**, when a Status store is wired: blocked and failed reports lead;
 * - **tasks**: in progress, approved, then proposals awaiting approval;
 * - **plan**, the plan bank: the current and next step;
 * - **git**: the Commit row needs a repository and a dirty tree;
 * - a gated kind needs its capability **and** evidence.
 *
 * The planning prompt goes where each host has it today: after the turn's
 * lead when something could be tracked here but nothing is (the desktop), and
 * last when nothing here tracks work (the CLI).
 */

/** Evidence that turns a capability into a row: GitHub with a pushed branch, or failing checks read in the background. */
export type GitHubEvidence = {
	pushed: boolean;
	/** Check names failing on this branch's PR, from GitHub's Read role. */
	failingChecks?: readonly string[];
	url?: string;
};

export type RuleInput = {
	backlog: Backlog;
	turn: TurnFacts;
	manifest: Pick<Manifest, "sources" | "capabilities" | "mode">;
	/** Files with uncommitted changes after the turn; undefined when unknown or not a repository. */
	dirtyFiles?: number;
	github?: GitHubEvidence;
};

/** Blocked and failed reports outrank everything else. */
const BLOCKING_STATUS_STATES: ReadonlySet<string> = new Set([
	"blocked",
	"failed",
]);

/** Blocked and failed reports for this chat, in the board's attention order. */
function blockingRows(
	input: Pick<RuleInput, "backlog" | "manifest">,
): Suggestion[] {
	if (!isPresent(input.manifest, "status")) return [];
	return input.backlog.statusRows
		.filter((row) => BLOCKING_STATUS_STATES.has(row.state))
		.map((row) =>
			suggestion(
				"fix_failure",
				"status",
				`Unblock ${row.subject}: ${row.headline}`,
				`The Status Hub reports ${row.state}: ${row.headline}`,
				{
					ref: row.subject,
				},
			),
		);
}

function trackedRows(input: RuleInput): Suggestion[] {
	const out: Suggestion[] = [];
	if (isPresent(input.manifest, "tasks")) {
		for (const task of rankTasks(input.backlog.tasks)) {
			const status = TASK_STATUSES[task.status];
			out.push(
				suggestion(
					"continue",
					"tasks",
					`${status.prompt}: ${task.title}`,
					status.why,
					{ ref: task.taskId },
				),
			);
		}
	}
	const bank = isPresent(input.manifest, "plan") ? input.backlog.bank : null;
	if (bank?.nowTitle) {
		out.push(
			suggestion(
				"continue",
				"bank",
				`Continue the current task: ${bank.nowTitle}`,
				"The current step in the plan.",
				{ ref: bank.nowTitle },
			),
		);
	}
	if (bank?.nextTitle) {
		out.push(
			suggestion(
				"next_step",
				"bank",
				`Do the next task: ${bank.nextTitle}`,
				"The next step in the plan.",
				{ ref: bank.nextTitle },
			),
		);
	}
	return out;
}

/** Check CI: GitHub in the manifest, a GitHub remote, and either failing checks read in the background or a push this turn. */
export function checkCiRow(input: RuleInput): Suggestion | null {
	const { github, manifest } = input;
	if (
		!github ||
		!offersKind(manifest, "check_ci") ||
		!manifest.capabilities.includes("remote:github")
	)
		return null;
	const failing = github.failingChecks ?? [];
	if (failing.length > 0) {
		return suggestion(
			"check_ci",
			"connector",
			`Fix the failing CI checks on this branch's pull request: ${failing.join(", ")}.`,
			`GitHub · CI failing: ${failing.join(", ")}`,
			{ url: github.url },
		);
	}
	if (!github.pushed) return null;
	return suggestion(
		"check_ci",
		"connector",
		"Check CI on this branch's pull request and fix what fails.",
		"This turn pushed the branch, and GitHub is connected.",
		{ url: github.url },
	);
}

/** Every row the rules can stand behind for this turn, best first, de-duplicated by prompt. */
export function rulePool(input: RuleInput): Suggestion[] {
	const tracked = trackedRows(input);
	const tracks =
		isPresent(input.manifest, "tasks") || isPresent(input.manifest, "plan");
	const plan = tracked.length === 0 ? planRow() : null;
	return uniqueByPrompt([
		...blockingRows(input),
		turnLead(input.turn),
		...tracked,
		tracks ? plan : null,
		checkCiRow(input),
		turnTail(input.turn),
		cleanEditReview(input.turn),
		input.manifest.mode === "plan" || !isPresent(input.manifest, "git")
			? null
			: commitRow(input.turn, input.dirtyFiles),
		tracks ? null : plan,
	]);
}

/** The next page of a pool: what was not offered or skipped yet, capped at the set size. */
export function pageSet(
	pool: readonly Suggestion[],
	excluded: readonly string[],
): Suggestion[] {
	return uniqueByPrompt(pool, new Set(excluded), SET_SIZE);
}
