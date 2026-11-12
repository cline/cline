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

const PATCH_TARGET = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm;

/** A write names its `path`, or, as apply_patch, each file its patch body adds, updates or deletes. */
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

/** A row keeps its id all turn, so a host's highlight stays on it as each new set arrives. */
const rowId = (turn: string, kind: string) => `${turn}:${kind}`;

/** One page of the pool as the slot's state. Core clamps every field, so this adds no text passes. */
export function state(
	rows: readonly Row[],
	cursor: number,
	turn: string,
	revision: string,
	facts: Facts,
): ComposerSuggestionsState {
	const items: ComposerSuggestionItem[] = rows
		.slice(cursor, cursor + SET_SIZE)
		.map((row) => ({
			id: rowId(turn, row.kind),
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

export function createNextTurnPlugin(): AgentPlugin {
	let ui: PluginUiContext | undefined;
	let facts: Facts | undefined;
	let cursor = 0;
	let revision = 0;
	/** The revision of the turn's first set, which every row id of the turn carries. */
	let turn = "";
	/** Kinds skipped this turn, so a new set does not bring them back. */
	let skipped = new Set<string>();
	let hiddenForChat = false;

	const stale = () => ({ outcome: "refused", reason: "stale" }) as const;

	const offered = (current: Facts) =>
		pool(current).filter((row) => !skipped.has(row.kind));

	const shown = (): ComposerSuggestionsState | null => {
		if (hiddenForChat) return hiddenState(`r${revision}`);
		if (!facts) return null;
		return state(offered(facts), cursor, turn, `r${revision}`, facts);
	};

	/** Every state published gets its own revision, so a refresh aimed at the set it replaced is refused; item verbs go by the row id, which holds all turn. */
	const publish = (next?: Facts) => {
		revision += 1;
		if (next) {
			facts = next;
			cursor = 0;
			turn = `r${revision}`;
			skipped = new Set();
		}
		ui?.update("composer.suggestions", shown());
	};

	const offers = (itemId: string) =>
		shown()?.items.some((item) => item.id === itemId) ?? false;

	/** The row an item verb names, skipped or not, from any set this turn. */
	const rowOf = (current: Facts, itemId: string) =>
		pool(current).find((row) => rowId(turn, row.kind) === itemId);

	const onAction = (action: ComposerSuggestionsAction): PluginUiActionReply => {
		switch (action.verb) {
			case "use":
			case "send":
				// A worker restarted after an idle reclaim has served no set, so the one clicked is still the last turn's: a newer turn would have reached afterRun here.
				return !facts || offers(action.itemId) ? { outcome: "ok" } : stale();
			case "skip": {
				if (!facts) return stale();
				const row = rowOf(facts, action.itemId);
				if (!row) return stale();
				// A row skipped from a set already paged past sits before the cursor, so the page steps back to keep its rows.
				const at = offered(facts).findIndex((r) => r.kind === row.kind);
				if (at >= 0 && at < cursor) cursor -= 1;
				skipped.add(row.kind);
				publish();
				return { outcome: "ok" };
			}
			case "unskip": {
				if (!facts) return stale();
				const row = rowOf(facts, action.itemId);
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
			// Core and the host keep a withdrawn set's revision, so a restarted worker counts on from the clock instead of reissuing it.
			revision = Date.now();
			turn = "";
			skipped = new Set();
			hiddenForChat = false;
			if (ui?.slots.includes("composer.suggestions")) {
				api.registerUiSlot?.({ slot: "composer.suggestions", onAction });
				// Setup reruns after an idle reclaim; knowing no turn, withdraw the set core still holds.
				ui.update("composer.suggestions", null);
			}
		},
	};
}
