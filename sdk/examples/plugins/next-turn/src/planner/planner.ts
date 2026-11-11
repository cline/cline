import type { AgentMessage, AgentRunResult, PluginAsides } from "@cline/shared";
import { summarizeTurn } from "../turn";
import type {
	Facts,
	FactsRead,
	NextTurnStatus,
	NextTurnSuggestion,
} from "../types";
import { readGitFacts } from "./git";
import { parsePlannerOutput, withFailureLead } from "./output";
import { buildPlannerInput } from "./prompt";
import { type RepoReader, readRepoFacts } from "./repo";
import type { RunCommand } from "./run";

/**
 * The planner runs detached from `afterRun`, after the rule set is already
 * out: it reads the workspace, asks the host one aside, and publishes the
 * model's set for the same run. Whatever goes wrong leaves the rule set as
 * the run's set.
 *
 * The aside reads none of the chat (`context: "none"`): the planner sends its
 * own redacted digest of the turn. The host makes the call on the chat's
 * provider, counts it against the plugin's hourly allowance, and ends it when
 * the chat moves on.
 */

/** The model call, a low-reasoning retry included. */
export const PLANNER_TIMEOUT_MS = 20_000;
export const PLANNER_MAX_OUTPUT_TOKENS = 400;
/** The git read may not hold the model call back longer than this. */
export const WORKSPACE_READ_BUDGET_MS = 400;

const GIT_NAME = "This folder's git state";
const REPO_NAME = "This repository's commands";

export type PlanRequest = {
	runId: string;
	messages: readonly AgentMessage[];
	result: AgentRunResult;
	/** The rule set for this run: its lead is kept after a failed or stopped turn. */
	rules: readonly NextTurnSuggestion[];
	workspaceRoot?: string;
};

export type PlannerDeps = {
	ask: PluginAsides["ask"];
	run: RunCommand;
	repo: RepoReader;
	timeoutMs?: number;
	publish(
		runId: string,
		status: NextTurnStatus,
		suggestions: NextTurnSuggestion[],
	): void;
	log(message: string, error?: unknown): void;
};

type Attempt = { runId: string };

/** The work's result, or `onTimeout` when it throws or outlasts the budget. */
async function withinBudget<T>(
	work: () => Promise<T> | T,
	budgetMs: number,
	onTimeout: T,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const expired = new Promise<T>((resolve) => {
		timer = setTimeout(() => resolve(onTimeout), budgetMs);
	});
	try {
		return await Promise.race([
			Promise.resolve()
				.then(work)
				.catch(() => onTimeout),
			expired,
		]);
	} finally {
		clearTimeout(timer);
	}
}

export class NextTurnPlanner {
	private current: Attempt | undefined;

	constructor(private readonly deps: PlannerDeps) {}

	/**
	 * Plans one run. Resolves when the attempt has settled and never rejects;
	 * callers do not wait for it. It yields to the event loop first, so the
	 * hook that started it returns before any of its work runs. A newer run's
	 * attempt supersedes this one.
	 */
	async start(request: PlanRequest): Promise<void> {
		const attempt: Attempt = { runId: request.runId };
		this.current = attempt;
		try {
			await new Promise<void>((resolve) => setImmediate(resolve));
			if (this.current === attempt) await this.plan(request, attempt);
		} catch (error) {
			this.deps.log("the planner failed", error);
		} finally {
			if (this.current === attempt) this.current = undefined;
		}
	}

	/** A new run began or the session ended: nothing the planner still waits for is worth showing. */
	supersede(): void {
		this.current = undefined;
	}

	private async readSources(
		workspaceRoot: string | undefined,
	): Promise<{ sources: Facts[]; unread: string[] }> {
		if (!workspaceRoot) return { sources: [], unread: [] };
		const read: Array<[string, FactsRead]> = await Promise.all([
			withinBudget<[string, FactsRead]>(
				async () => [
					GIT_NAME,
					await readGitFacts(this.deps.run, workspaceRoot),
				],
				WORKSPACE_READ_BUDGET_MS,
				[GIT_NAME, "unknown"],
			),
			withinBudget<[string, FactsRead]>(
				() => [REPO_NAME, readRepoFacts(workspaceRoot, this.deps.repo)],
				WORKSPACE_READ_BUDGET_MS,
				[REPO_NAME, "unknown"],
			),
		]);
		return {
			sources: read.flatMap(([, facts]) =>
				facts && facts !== "unknown" ? [facts] : [],
			),
			unread: read.flatMap(([name, facts]) =>
				facts === "unknown" ? [name] : [],
			),
		};
	}

	private async plan(request: PlanRequest, attempt: Attempt): Promise<void> {
		const summary = summarizeTurn(request.messages, request.result);
		if (!summary.chat) return;
		const { sources, unread } = await this.readSources(request.workspaceRoot);
		if (this.current !== attempt) return;
		const input = buildPlannerInput({
			facts: summary.facts,
			context: summary.context,
			mode: summary.mode,
			sources,
			unread,
		});
		const answer = await this.deps.ask({
			runId: request.runId,
			context: "none",
			system: input.system,
			prompt: input.user,
			maxOutputTokens: PLANNER_MAX_OUTPUT_TOKENS,
			timeoutMs: this.deps.timeoutMs ?? PLANNER_TIMEOUT_MS,
		});
		if (this.current !== attempt) return;
		if (answer.status !== "ok") {
			const why = answer.status === "skipped" ? answer.reason : answer.status;
			this.deps.log(`the planner's aside ended as ${why}; the rules stay`);
			return;
		}
		const rows = parsePlannerOutput(answer.text);
		if (!rows) {
			this.deps.log("the planner's answer had no usable row; the rules stay");
			return;
		}
		this.deps.publish(
			request.runId,
			summary.facts.status,
			withFailureLead(rows, request.rules, summary.facts),
		);
	}
}
