import type {
	AgentMessage,
	AgentRunResult,
	ClientContext,
} from "@cline/shared";
import { summarizeTurn } from "../turn";
import type {
	Facts,
	FactsRead,
	NextTurnStatus,
	NextTurnSuggestion,
} from "../types";
import type { Allowance, PlannerOutcome } from "./allowance";
import type { Complete } from "./completer";
import { readGitFacts } from "./git";
import { parsePlannerOutput, withFailureLead } from "./output";
import { buildPlannerInput } from "./prompt";
import { type RepoReader, readRepoFacts } from "./repo";
import type { RunCommand } from "./run";

/**
 * The planner runs detached from `afterRun`, after the rule set is already
 * out: it reads the workspace, makes one bounded tool-less model call, and
 * publishes the model's set for the same run. Whatever goes wrong leaves the
 * rule set as the run's set.
 */

/** The whole attempt: reading the workspace and the model call, a low-reasoning retry included. */
export const PLANNER_TIMEOUT_MS = 20_000;
/** The git read may not hold the model call back longer than this. */
export const WORKSPACE_READ_BUDGET_MS = 400;

const GIT_NAME = "This folder's git state";
const REPO_NAME = "This repository's commands";

export type PlanRequest = {
	runId: string;
	sessionId: string;
	messages: readonly AgentMessage[];
	result: AgentRunResult;
	/** The rule set for this run: its lead is kept after a failed or stopped turn. */
	rules: readonly NextTurnSuggestion[];
	workspaceRoot?: string;
	client?: ClientContext;
};

export type PlannerDeps = {
	complete: Complete;
	allowance: Allowance;
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

type Attempt = { runId: string; abort: AbortController };

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

/** Rejects once `signal` aborts; the work's late result or failure is ignored. */
function raceAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => reject(new Error("the planner call was aborted"));
		if (signal.aborted) return onAbort();
		signal.addEventListener("abort", onAbort, { once: true });
		work
			.then(resolve, reject)
			.finally(() => signal.removeEventListener("abort", onAbort));
	});
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
		this.supersede();
		const attempt: Attempt = {
			runId: request.runId,
			abort: new AbortController(),
		};
		this.current = attempt;
		try {
			await new Promise<void>((resolve) => setImmediate(resolve));
			if (!attempt.abort.signal.aborted) await this.plan(request, attempt);
		} catch (error) {
			this.deps.log("the planner failed", error);
		} finally {
			if (this.current === attempt) this.current = undefined;
		}
	}

	/** A new run began or the session ended: nothing the planner still waits for is worth showing. */
	supersede(): void {
		this.current?.abort.abort();
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
		const slot = this.deps.allowance.reserve(request.sessionId);
		if (!slot) {
			this.deps.log("the planner's hourly allowance is used; the rules stay");
			return;
		}
		const { signal } = attempt.abort;
		const startedAt = Date.now();
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			attempt.abort.abort();
		}, this.deps.timeoutMs ?? PLANNER_TIMEOUT_MS);
		let sent = false;
		let outcome: PlannerOutcome = "error";
		let spend: {
			inputTokens?: number;
			outputTokens?: number;
			costUsd?: number;
		} = {};
		try {
			const { sources, unread } = await this.readSources(request.workspaceRoot);
			if (signal.aborted) throw new Error("the planner call was aborted");
			sent = true;
			const completion = await raceAbort(
				this.deps.complete({
					input: buildPlannerInput({
						facts: summary.facts,
						context: summary.context,
						mode: summary.mode,
						sources,
						unread,
					}),
					chat: summary.chat,
					sessionId: request.sessionId,
					client: request.client,
					signal,
				}),
				signal,
			);
			if (!completion) {
				sent = false;
				return;
			}
			spend = completion.usage ?? {};
			const rows = parsePlannerOutput(completion.text);
			if (!rows) outcome = "unparseable";
			else {
				this.deps.publish(
					request.runId,
					summary.facts.status,
					withFailureLead(rows, request.rules, summary.facts),
				);
				outcome = "ok";
			}
		} catch (error) {
			outcome = timedOut ? "timeout" : signal.aborted ? "aborted" : "error";
			if (outcome === "error") this.deps.log("the planner call failed", error);
		} finally {
			clearTimeout(timer);
			if (sent)
				slot.record({
					outcome,
					totalMs: Date.now() - startedAt,
					providerId: summary.chat.providerId,
					modelId: summary.chat.modelId,
					...spend,
				});
			else slot.release();
		}
	}
}
