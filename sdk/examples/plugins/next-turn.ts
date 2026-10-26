import type { AgentPlugin } from "@cline/core";
import type { AgentMessage, AgentRunResult } from "@cline/shared";

const WRITE_TOOLS: ReadonlySet<string> = new Set([
	"editor",
	"write_to_file",
	"replace_in_file",
	"apply_patch",
]);
const PATCH_TARGET = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm;
const SET_SIZE = 3;

export type NextTurnFacts = {
	status: "completed" | "cancelled" | "failed";
	filesEdited: number;
	toolErrored: boolean;
};

export type NextTurnCandidate = {
	kind:
		| "continue"
		| "fix_failure"
		| "verify"
		| "review_diff"
		| "wrap_up"
		| "next_step";
	prompt: string;
};

function editedPaths(input: unknown): string[] {
	const fields: { path?: unknown; input?: unknown } =
		input && typeof input === "object" ? input : {};
	const patch = typeof input === "string" ? input : fields.input;
	if (typeof patch === "string") {
		return [...patch.matchAll(PATCH_TARGET)].flatMap(
			(match) => match[1]?.trim() || [],
		);
	}
	return typeof fields.path === "string" && fields.path.length > 0
		? [fields.path]
		: [];
}

/** Only messages after the newest real user prompt belong to the finished turn. */
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
): NextTurnFacts {
	const edits = new Map<string, string[]>();
	let toolErrored = false;
	for (const message of finishedTurn(messages)) {
		for (const part of message.content) {
			if (part.type === "tool-call" && WRITE_TOOLS.has(part.toolName)) {
				edits.set(part.toolCallId, editedPaths(part.input));
			} else if (part.type === "tool-result" && part.isError) {
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

/** Every recommendation the rules can stand behind for this turn, best first. */
export function pool(facts: NextTurnFacts): NextTurnCandidate[] {
	const rows: NextTurnCandidate[] = [];
	if (facts.status === "cancelled") {
		rows.push({
			kind: "continue",
			prompt: "Pick up the work the stopped turn left unfinished.",
		});
	}
	if (facts.status === "failed") {
		rows.push({
			kind: "fix_failure",
			prompt: "Retry the last turn -- it ended in an error.",
		});
	} else if (facts.toolErrored) {
		rows.push({
			kind: "fix_failure",
			prompt: "Fix the failure from the last turn and run it again.",
		});
	}
	if (facts.status === "completed") {
		if (facts.filesEdited > 0) {
			rows.push(
				{
					kind: "verify",
					prompt: "Run the checks for the files the last turn changed.",
				},
				{
					kind: "review_diff",
					prompt: "Review the changes from the last turn before going on.",
				},
			);
		}
		rows.push({
			kind: "wrap_up",
			prompt: "Summarize what the last turn did and what is left to do.",
		});
	}
	rows.push({
		kind: "next_step",
		prompt: "Plan the next few tasks for this work.",
	});
	return rows;
}

/**
 * Keeps only the current root turn's candidates. Hosts choose how to present
 * them; accepting and cycling suggestions never calls back into the plugin.
 */
export function createNextTurnPlugin(): AgentPlugin {
	let candidates: readonly NextTurnCandidate[] = [];
	return {
		name: "next-turn",
		manifest: { capabilities: ["hooks", "commands"] },
		setup(api) {
			candidates = [];
			api.registerCommand({
				name: "next",
				description: "Use the best next-turn suggestion",
				handler(input) {
					if (input.trim() === "--format=json") {
						return {
							reply: JSON.stringify({
								v: 1,
								suggestions: candidates.map((candidate) => candidate.prompt),
							}),
						};
					}
					const best = candidates[0];
					return best
						? { submitPrompt: best.prompt }
						: { reply: "No next-turn suggestion is available yet." };
				},
			});
		},
		hooks: {
			beforeRun({ snapshot }) {
				if (!snapshot.parentAgentId) candidates = [];
				return undefined;
			},
			afterRun({ snapshot, result }) {
				if (snapshot.parentAgentId) return;
				candidates = pool(factsOf(result.messages, result)).slice(0, SET_SIZE);
			},
		},
	};
}

const plugin = createNextTurnPlugin();
export { plugin };
export default plugin;
