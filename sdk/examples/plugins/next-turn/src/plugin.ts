import type { AgentPlugin } from "@cline/core";
import type {
	AgentMessage,
	AgentRunResult,
	PluginSetupContext,
} from "@cline/shared";

export const NEXT_TURN_SUGGESTIONS_EVENT = "next_turn.suggestions";
const WRITE_TOOLS = new Set([
	"editor",
	"write_to_file",
	"replace_in_file",
	"apply_patch",
]);
const PATCH_TARGET = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm;
const MAX_SUGGESTIONS = 3;

export type NextTurnStatus = "completed" | "cancelled" | "failed";
export interface NextTurnSuggestion {
	kind: string;
	label: string;
	prompt: string;
	reason: string;
}
export interface NextTurnSuggestionsEvent {
	sessionId?: string;
	runId: string;
	status: NextTurnStatus;
	suggestions: NextTurnSuggestion[];
}
type Facts = {
	status: NextTurnStatus;
	filesEdited: number;
	toolErrored: boolean;
};

function editedPaths(input: unknown): string[] {
	const fields: { path?: unknown; input?: unknown } =
		input && typeof input === "object" ? input : {};
	const patch = typeof input === "string" ? input : fields.input;
	if (typeof patch === "string")
		return [...patch.matchAll(PATCH_TARGET)].flatMap(
			(match) => match[1]?.trim() || [],
		);
	return typeof fields.path === "string" && fields.path.length > 0
		? [fields.path]
		: [];
}

/** Only messages after the newest real user prompt belong to this turn. */
function finishedTurn(
	messages: readonly AgentMessage[],
): readonly AgentMessage[] {
	const prompt = messages.findLastIndex(
		(message) => message.role === "user" && message.metadata?.userRunSpan !== 0,
	);
	return messages.slice(prompt + 1);
}

export function factsOf(
	messages: readonly AgentMessage[],
	result: AgentRunResult,
): Facts {
	const edits = new Map<string, string[]>();
	let toolErrored = false;
	for (const message of finishedTurn(messages)) {
		for (const part of message.content) {
			if (part.type === "tool-call" && WRITE_TOOLS.has(part.toolName))
				edits.set(part.toolCallId, editedPaths(part.input));
			else if (part.type === "tool-result" && part.isError) {
				toolErrored = true;
				edits.delete(part.toolCallId);
			}
		}
	}
	const paths = new Set([...edits.values()].flat());
	const status =
		result.status === "aborted"
			? "cancelled"
			: result.status === "failed"
				? "failed"
				: "completed";
	return { status, filesEdited: paths.size || edits.size, toolErrored };
}

const row = (
	kind: string,
	label: string,
	prompt: string,
	reason: string,
): NextTurnSuggestion => ({
	kind,
	label,
	prompt,
	reason,
});

/** Rules are ordered by how immediately useful they are after this turn. */
export function pool(facts: Facts): NextTurnSuggestion[] {
	const rows: NextTurnSuggestion[] = [];
	if (facts.status === "cancelled")
		rows.push(
			row(
				"continue",
				"Resume",
				"Pick up the work the stopped turn left unfinished.",
				"The last turn was stopped before it finished.",
			),
		);
	if (facts.status === "failed")
		rows.push(
			row(
				"fix_failure",
				"Fix",
				"Retry the last turn — it ended in an error.",
				"The last turn ended in an error.",
			),
		);
	else if (facts.toolErrored)
		rows.push(
			row(
				"fix_failure",
				"Fix",
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
					"Verify",
					"Run the checks for the files the last turn changed.",
					changed,
				),
				row(
					"review_diff",
					"Review",
					"Review the changes from the last turn before going on.",
					changed,
				),
			);
		}
		rows.push(
			row(
				"wrap_up",
				"Wrap up",
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
			"Next step",
			"Plan the next few tasks for this work.",
			"Nothing is tracked for this chat yet, so the next step is to plan some.",
		),
	);
	return rows;
}

export function createNextTurnPlugin(): AgentPlugin {
	let emitEvent: PluginSetupContext["emitEvent"];
	let sessionId: string | undefined;
	return {
		name: "next-turn",
		manifest: { capabilities: ["hooks"] },
		setup(_api, context) {
			emitEvent = context.emitEvent;
			sessionId = context.session?.sessionId;
		},
		hooks: {
			afterRun({ snapshot, result }) {
				if (snapshot.parentAgentId) return;
				const facts = factsOf(result.messages, result);
				const payload: NextTurnSuggestionsEvent = {
					...(sessionId ? { sessionId } : {}),
					runId: result.runId,
					status: facts.status,
					suggestions: pool(facts).slice(0, MAX_SUGGESTIONS),
				};
				emitEvent?.(NEXT_TURN_SUGGESTIONS_EVENT, payload);
			},
		},
	};
}
