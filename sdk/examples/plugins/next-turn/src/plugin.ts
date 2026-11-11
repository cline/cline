import type { AgentPlugin } from "@cline/core";
import type { PluginSetupContext } from "@cline/shared";
import { NextTurnPlanner, type PlannerDeps } from "./planner/planner";
import { RepoReader } from "./planner/repo";
import { runCommand } from "./planner/run";
import { factsOf } from "./turn";
import {
	NEXT_TURN_LABELS,
	type NextTurnKind,
	type NextTurnSource,
	type NextTurnStatus,
	type NextTurnSuggestion,
	type NextTurnSuggestionsEvent,
	type TurnFacts,
} from "./types";

export { factsOf } from "./turn";
export type {
	NextTurnStatus,
	NextTurnSuggestion,
	NextTurnSuggestionsEvent,
} from "./types";

export const NEXT_TURN_SUGGESTIONS_EVENT = "next_turn.suggestions";
const MAX_SUGGESTIONS = 3;

const row = (
	kind: NextTurnKind,
	prompt: string,
	reason: string,
): NextTurnSuggestion => ({
	kind,
	label: NEXT_TURN_LABELS[kind],
	prompt,
	reason,
});

/** Rules are ordered by how immediately useful they are after this turn. */
export function pool(facts: TurnFacts): NextTurnSuggestion[] {
	const rows: NextTurnSuggestion[] = [];
	if (facts.status === "cancelled")
		rows.push(
			row(
				"continue",
				"Pick up the work the stopped turn left unfinished.",
				"The last turn was stopped before it finished.",
			),
		);
	if (facts.status === "failed")
		rows.push(
			row(
				"fix_failure",
				"Retry the last turn. It ended in an error.",
				"The last turn ended in an error.",
			),
		);
	else if (facts.toolErrored)
		rows.push(
			row(
				"fix_failure",
				"Fix the failure from the last turn and run it again.",
				"A command in the last turn failed.",
			),
		);
	if (facts.status === "completed") {
		if (facts.filesEdited > 0) {
			const changed = `${facts.filesEdited} file${facts.filesEdited === 1 ? "" : "s"} changed this turn.`;
			rows.push(
				row(
					"verify",
					"Run the checks for the files the last turn changed.",
					changed,
				),
				row(
					"review_diff",
					"Review the changes from the last turn before going on.",
					changed,
				),
			);
		}
		rows.push(
			row(
				"wrap_up",
				"Summarize what the last turn did and what is left to do.",
				facts.filesEdited > 0
					? "The last turn changed files."
					: "The last turn completed without changing files.",
			),
		);
	}
	rows.push(
		row(
			"next_step",
			"Plan the next few tasks for this work.",
			"Nothing is tracked for this chat yet, so the next step is to plan some.",
		),
	);
	return rows;
}

export interface NextTurnPluginOptions {
	/**
	 * `false` keeps the plugin rule-only. Otherwise each field replaces its
	 * default: the host's `ctx.asides.ask` and `git` on the workspace. A host
	 * that offers no asides leaves the plugin rule-only too.
	 */
	planner?:
		| false
		| Partial<Pick<PlannerDeps, "ask" | "run" | "repo" | "timeoutMs">>;
}

export function createNextTurnPlugin(
	options: NextTurnPluginOptions = {},
): AgentPlugin {
	let context: PluginSetupContext = {};
	let planner: NextTurnPlanner | undefined;
	const emit = (
		runId: string,
		status: NextTurnStatus,
		suggestions: NextTurnSuggestion[],
		source: NextTurnSource,
	) => {
		const payload: NextTurnSuggestionsEvent = {
			runId,
			status,
			source,
			suggestions,
		};
		context.emitEvent?.(NEXT_TURN_SUGGESTIONS_EVENT, payload);
	};
	return {
		name: "next-turn",
		manifest: { capabilities: ["hooks", "asides"], rootOnly: true },
		setup(_api, setupContext) {
			context = setupContext;
			planner?.supersede();
			const asides = setupContext.asides;
			const ask =
				options.planner === false
					? undefined
					: (options.planner?.ask ??
						(asides ? (request) => asides.ask(request) : undefined));
			planner =
				options.planner === false || !ask
					? undefined
					: new NextTurnPlanner({
							ask,
							run: options.planner?.run ?? runCommand,
							repo: options.planner?.repo ?? new RepoReader(),
							timeoutMs: options.planner?.timeoutMs,
							publish: (runId, status, suggestions) =>
								emit(runId, status, suggestions, "model"),
							log: (message, error) =>
								context.logger?.debug(
									`next-turn: ${message}`,
									error === undefined ? undefined : { error: String(error) },
								),
						});
			setupContext.onDispose?.(() => planner?.supersede());
		},
		hooks: {
			beforeRun({ snapshot }) {
				if (!snapshot.parentAgentId) planner?.supersede();
				return undefined;
			},
			afterRun({ snapshot, result, continuation }) {
				if (snapshot.parentAgentId) return;
				const facts = factsOf(result.messages, result);
				const rules = pool(facts).slice(0, MAX_SUGGESTIONS);
				emit(result.runId, facts.status, rules, "rules");
				// The host is about to start another run in this turn, which would
				// end the aside before it answered.
				if (continuation) return;
				void planner?.start({
					runId: result.runId,
					messages: result.messages,
					result,
					rules,
					workspaceRoot: context.workspaceInfo?.rootPath ?? context.cwd,
				});
			},
		},
	};
}
