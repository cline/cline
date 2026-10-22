import type { AgentPlugin } from "@cline/core";
import type {
	AgentMessage,
	AgentRunResult,
	ComposerSuggestionItem,
	ComposerSuggestionsAction,
	ComposerSuggestionsState,
	PluginUiActionReply,
	PluginUiContext,
} from "@cline/shared";

/** Files this plugin treats as edits: the only vocabulary a hook sees of a tool. */
const WRITE_TOOLS: ReadonlySet<string> = new Set([
	"editor",
	"write_to_file",
	"replace_in_file",
	"apply_patch",
]);

const TITLE = "Next";
const COMMAND = "next";
const SET_SIZE = 3;

type Facts = {
	status: "completed" | "cancelled" | "failed";
	filesEdited: number;
	toolErrored: boolean;
};

function editedPath(input: unknown): string | undefined {
	if (!input || typeof input !== "object") return undefined;
	const path = (input as { path?: unknown }).path;
	return typeof path === "string" && path.length > 0 ? path : undefined;
}

/**
 * The run result carries the whole chat, so the finished turn is what follows
 * the newest prompt. Core marks the user messages it adds mid-run (reminders,
 * hook context, steering) with userRunSpan 0, and those stay inside the turn.
 */
function finishedTurn(
	messages: readonly AgentMessage[],
): readonly AgentMessage[] {
	const prompt = messages.findLastIndex(
		(message) => message.role === "user" && message.metadata?.userRunSpan !== 0,
	);
	return messages.slice(prompt + 1);
}

/** Status and edits from the finished turn; a write counts once its result did not error. */
export function factsOf(
	messages: readonly AgentMessage[],
	result: AgentRunResult,
): Facts {
	const edits = new Map<string, string | undefined>();
	let toolErrored = false;
	for (const message of finishedTurn(messages)) {
		for (const part of message.content) {
			if (part.type === "tool-call" && WRITE_TOOLS.has(part.toolName))
				edits.set(part.toolCallId, editedPath(part.input));
			else if (part.type === "tool-result" && part.isError) {
				toolErrored = true;
				edits.delete(part.toolCallId);
			}
		}
	}
	const paths = new Set([...edits.values()].filter((p): p is string => !!p));
	const status =
		result.status === "aborted"
			? "cancelled"
			: result.status === "failed"
				? "failed"
				: "completed";
	return { status, filesEdited: paths.size || edits.size, toolErrored };
}

type Row = {
	kind: string;
	tone: ComposerSuggestionItem["tone"];
	icon: ComposerSuggestionItem["icon"];
	label: string;
	prompt: string;
	why: string;
};

/** Every row the rules can stand behind for this turn, best first. */
export function pool(facts: Facts): Row[] {
	const rows: Row[] = [];
	if (facts.status === "cancelled")
		rows.push({
			kind: "continue",
			tone: "continue",
			icon: "resume",
			label: "Resume",
			prompt: "Pick up the work the stopped turn left unfinished.",
			why: "The last turn was stopped before it finished.",
		});
	if (facts.status === "failed")
		rows.push({
			kind: "fix_failure",
			tone: "repair",
			icon: "fix",
			label: "Fix",
			prompt: "Retry the last turn — it ended in an error.",
			why: "The last turn ended in an error.",
		});
	else if (facts.toolErrored)
		rows.push({
			kind: "fix_failure",
			tone: "repair",
			icon: "fix",
			label: "Fix",
			prompt: "Fix the failure from the last turn and run it again.",
			why: "A command in the last turn failed.",
		});
	if (facts.status === "completed") {
		if (facts.filesEdited > 0) {
			const changed =
				facts.filesEdited === 1
					? "1 file changed this turn."
					: `${facts.filesEdited} files changed this turn.`;
			rows.push({
				kind: "verify",
				tone: "check",
				icon: "verify",
				label: "Verify",
				prompt: "Run the checks for the files the last turn changed.",
				why: changed,
			});
			rows.push({
				kind: "review_diff",
				tone: "look",
				icon: "review",
				label: "Review",
				prompt: "Review the changes from the last turn before going on.",
				why: changed,
			});
		}
		rows.push({
			kind: "wrap_up",
			tone: "continue",
			icon: "next",
			label: "Wrap up",
			prompt: "Summarize what the last turn did and what is left to do.",
			why:
				facts.filesEdited > 0
					? "The last turn changed files."
					: "The last turn completed without changing files.",
		});
	}
	rows.push({
		kind: "next_step",
		tone: "continue",
		icon: "next",
		label: "Next step",
		prompt: "Plan the next few tasks for this work.",
		why: "Nothing is tracked for this chat yet, so the next step is to plan some.",
	});
	return rows;
}

const CUE: Record<
	Facts["status"],
	{ text: string; tone: ComposerSuggestionItem["tone"] }
> = {
	completed: { text: "after the last turn", tone: "neutral" },
	cancelled: { text: "after the turn you stopped", tone: "neutral" },
	failed: { text: "after the turn that failed", tone: "repair" },
};

const rowId = (revision: string, kind: string) => `${revision}:${kind}`;

/** One page of the pool as the slot's state. Core clamps every field, so this adds no text passes. */
export function state(
	rows: readonly Row[],
	cursor: number,
	revision: string,
	facts: Facts,
): ComposerSuggestionsState {
	const items: ComposerSuggestionItem[] = rows
		.slice(cursor, cursor + SET_SIZE)
		.map((row) => ({
			id: rowId(revision, row.kind),
			label: row.label,
			tone: row.tone,
			...(row.icon ? { icon: row.icon } : {}),
			prompt: row.prompt,
			detail: row.why,
			sendable: true,
		}));
	return {
		status: items.length > 0 ? "ready" : "empty",
		title: TITLE,
		command: COMMAND,
		revision,
		cue: CUE[facts.status],
		items,
		canRefresh: cursor + SET_SIZE < rows.length,
	};
}

/** Off for this chat until `show`; `command` keeps `/next on` reachable. */
function hiddenState(revision: string): ComposerSuggestionsState {
	return {
		status: "hidden",
		hiddenReason: "user",
		title: TITLE,
		command: COMMAND,
		revision,
		items: [],
		canRefresh: false,
	};
}

type ItemRef = { revision: string; itemId: string };

export function createNextTurnPlugin(): AgentPlugin {
	let ui: PluginUiContext | undefined;
	let facts: Facts | undefined;
	let cursor = 0;
	let revision = 0;
	/** Kinds skipped this turn, so a new set does not bring them back. */
	let skipped = new Set<string>();
	/** Revisions served this turn, so Undo skip still reaches a row after a new set. */
	let turnRevisions = new Set<string>();
	let hiddenForChat = false;

	const stale = () => ({ outcome: "refused", reason: "stale" }) as const;

	const offered = (current: Facts) =>
		pool(current).filter((row) => !skipped.has(row.kind));

	const shown = (): ComposerSuggestionsState | null => {
		if (hiddenForChat) return hiddenState(`r${revision}`);
		if (!facts) return null;
		return state(offered(facts), cursor, `r${revision}`, facts);
	};

	const publish = (next?: Facts) => {
		if (next) {
			facts = next;
			cursor = 0;
			revision += 1;
			skipped = new Set();
			turnRevisions = new Set();
		}
		turnRevisions.add(`r${revision}`);
		ui?.update("composer.suggestions", shown());
	};

	const offers = (ref: ItemRef) => {
		const current = shown();
		return (
			current?.revision === ref.revision &&
			current.items.some((item) => item.id === ref.itemId)
		);
	};

	/** The row an item verb names, skipped or not, from a set served this turn. */
	const rowOf = (current: Facts, ref: ItemRef) =>
		turnRevisions.has(ref.revision)
			? pool(current).find(
					(row) => rowId(ref.revision, row.kind) === ref.itemId,
				)
			: undefined;

	const onAction = (action: ComposerSuggestionsAction): PluginUiActionReply => {
		switch (action.verb) {
			case "use":
			case "send":
				return offers(action) ? { outcome: "ok" } : stale();
			case "skip": {
				if (!facts || action.revision !== `r${revision}`) return stale();
				const row = rowOf(facts, action);
				if (!row) return stale();
				skipped.add(row.kind);
				publish();
				return { outcome: "ok" };
			}
			case "unskip": {
				if (!facts) return stale();
				const row = rowOf(facts, action);
				if (!row || !skipped.delete(row.kind)) return stale();
				// A row skipped from an earlier set comes back into view, not behind the cursor.
				const at = offered(facts).findIndex((r) => r.kind === row.kind);
				cursor = Math.min(cursor, at);
				publish();
				return { outcome: "ok" };
			}
			case "refresh": {
				if (!facts || action.revision !== `r${revision}`) return stale();
				// "more" is Skip on the last row, so it drops that row instead of sliding the set.
				const last = offered(facts)
					.slice(cursor, cursor + SET_SIZE)
					.at(-1);
				if (action.cause === "more" && last) skipped.add(last.kind);
				else cursor += 1;
				revision += 1;
				publish();
				return { outcome: "ok" };
			}
			case "hide":
				if (action.scope === "chat") {
					hiddenForChat = true;
					publish();
				}
				return { outcome: "ok" };
			case "show":
				hiddenForChat = false;
				publish();
				return { outcome: "ok" };
			default:
				return { outcome: "ok" };
		}
	};

	return {
		name: "next-turn",
		manifest: { capabilities: ["hooks"] },
		hooks: {
			afterRun(hook) {
				if (hook.snapshot.parentAgentId) return;
				publish(factsOf(hook.result.messages, hook.result));
			},
		},
		setup(api, rawContext) {
			ui = rawContext.ui;
			facts = undefined;
			cursor = 0;
			revision = 0;
			skipped = new Set();
			turnRevisions = new Set();
			hiddenForChat = false;
			if (ui?.slots.includes("composer.suggestions")) {
				api.registerUiSlot?.({ slot: "composer.suggestions", onAction });
				// Setup reruns after an idle reclaim; knowing no turn, withdraw the set core still holds.
				ui.update("composer.suggestions", null);
			}
		},
	};
}
