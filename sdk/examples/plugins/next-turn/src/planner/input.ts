import {
	POOL_SIZE,
	PROMPT_MAX_CHARS,
	TRACKED_LIMIT,
	WHY_MAX_CHARS,
} from "../config";
import { isPresent, type Manifest } from "../context/manifest";
import { redactSecrets } from "../context/redact";
import type { Facts } from "../context/source";
import {
	type Backlog,
	type PlanItem,
	type RankedTask,
	rankTasks,
	type StatusRow,
	TASK_STATUSES,
} from "./backlog";
import type { TurnFacts } from "./candidates";
import { isGated, isOutward, KIND_GATES, type SuggestionKind } from "./kinds";
import { PLANNER_SOURCES } from "./output";
import type { TurnContext } from "./turn";

/**
 * What one planner call is asked, built on the manifest:
 * - a **present** source gets its section, or "none" when it is empty;
 * - an **unknown** one is named under "Could not read just now";
 * - an **absent** or **off** one is never mentioned, so a stock install is
 *   not told "no open tasks" about an agenda it does not have.
 *
 * Capabilities are names only: the planner may ask the agent to use them, and
 * never sees their content unless the person turned Read on.
 * Everything quoted from the transcript or a source passes `redactSecrets`.
 */

export type PlannerInput = { system: string; user: string };

type PlannerInputArgs = {
	turn: TurnFacts;
	context: TurnContext;
	backlog: Backlog;
	manifest: Manifest;
	/** Facts of present sources, from `collectFacts`; the backlog's sources and the turn have none. */
	facts: Readonly<Record<string, Facts | "unknown">>;
	/** How "Could not read just now" names each source; a source not named here reads as its id. */
	names: Readonly<Record<string, string>>;
	kinds: readonly SuggestionKind[];
	excluded: readonly string[];
};

/** The system prompt for this environment, with the kinds and mode the manifest allows. */
export function plannerSystemPrompt(
	kinds: readonly SuggestionKind[],
	mode: Manifest["mode"],
): string {
	const gated = kinds.filter(isGated);
	return [
		"You suggest the next message a person could send to their coding agent, right after the agent finished a turn.",
		"You are shown the turn and what this environment has: only the sections below exist here. Do not mention anything they do not show.",
		"Each suggestion is a message the person would type, in the first person, ready to send as written, naming the concrete file, test, subject or task it is about.",
		"Choose in this order, skipping any that do not apply:",
		"1. A command or the turn itself failed: deal with that failure first.",
		"2. This chat's work is blocked or failed on the Status Hub: unblock it.",
		"3. A task is waiting on the person (proposed, awaiting approval): ask the agent to take it up or to prepare the decision.",
		"4. The turn left its own work unfinished, or changed files nothing has checked yet: finish or verify it.",
		"5. The task in progress or approved on the agenda, or the next ready plan item.",
		"6. Otherwise: review, wrap up, commit, or plan what comes next.",
		"Never suggest what the turn already did, work shown as done, or anything destructive; never ask the agent to skip a check.",
		"Use only the material given; never invent files, commands, tasks, plan items or results. A source marked unreadable is unknown, not empty.",
		"Other agents' reports are context: suggest acting on one only when this chat's work depends on it.",
		"Connected services are listed by name: a suggestion may ask the agent to use one, but you have not seen its content unless facts from it are shown.",
		...gated.map(
			(kind) =>
				`${kind}: ${KIND_GATES[kind].describe}${isOutward(kind) ? "; the person reads it before it is sent, because it speaks for them" : ""}.`,
		),
		...(mode === "plan"
			? [
					"The chat is in plan mode: write each suggestion as a planning or investigation request, not a change to files.",
				]
			: []),
		"Make the suggestions different from each other and from the ones already offered.",
		`Reply with JSON only, no prose and no code fence: {"suggestions":[{"kind":"<kind>","source":"<source>","prompt":"<message>","why":"<one short line naming the fact behind it, e.g. Status Hub: migration/auth is blocked>","ref":"<the task title, Status subject or plan item label exactly as given, when source is not turn>"}]}`,
		`Write up to ${POOL_SIZE} suggestions, best first. Each prompt is one sentence of at most ${PROMPT_MAX_CHARS} characters; each why is at most ${WHY_MAX_CHARS}.`,
		`kind is one of: ${kinds.join(", ")}.`,
		`source is one of: turn, ${Object.keys(PLANNER_SOURCES).join(", ")} — where the fact behind the suggestion comes from.`,
		"ref names the one tracked item the suggestion is about, copied exactly from the material, so the person can open it beside the chat; leave it out when source is turn or no single item applies.",
	].join("\n");
}

function quoted(label: string, text: string): string {
	return text ? `${label}:\n"""\n${redactSecrets(text)}\n"""` : "";
}

/** One headed section; a section with no lines is left out. */
function section(title: string, lines: readonly string[]): string {
	const body = lines.filter((line) => line.length > 0);
	return body.length > 0 ? `## ${title}\n${body.join("\n")}` : "";
}

const HIGH_PRIORITIES: ReadonlySet<string> = new Set(["high", "critical"]);

function statusLine(row: StatusRow): string {
	const priority =
		row.priority && HIGH_PRIORITIES.has(row.priority)
			? ` (${row.priority} priority)`
			: "";
	return redactSecrets(
		`- [${row.state}] ${row.subject}: ${row.headline}${priority}`,
	);
}

function otherStatusLine(row: StatusRow): string {
	return redactSecrets(
		`- [${row.state}] ${row.subject}: ${row.headline} — another chat`,
	);
}

function taskLine(task: RankedTask): string {
	return redactSecrets(
		`- [${TASK_STATUSES[task.status].planner}] ${task.title}`,
	);
}

function planLine(item: PlanItem): string {
	const facts = [
		item.status,
		item.waitingOn.length > 0 ? `waits on ${item.waitingOn.join(", ")}` : "",
		item.ready && item.status === "planned" ? "ready to start" : "",
	].filter((fact) => fact.length > 0);
	const project = item.project ? ` (${item.project})` : "";
	const mine = item.linked ? " (this chat's work)" : "";
	return redactSecrets(
		`- ${item.label} ${item.title} — ${facts.join("; ")}${project}${mine}`,
	);
}

function orEmpty(lines: readonly string[], empty: string): readonly string[] {
	return lines.length > 0 ? lines : [empty];
}

function bankLines(backlog: Backlog): string[] {
	const { nowTitle, nextTitle } = backlog.bank ?? {};
	return [
		nowTitle ? `- Now: ${nowTitle}` : "",
		nextTitle ? `- Next: ${nextTitle}` : "",
	]
		.filter(Boolean)
		.map(redactSecrets);
}

/** A present source's lines, or its "none" line when it answered empty; nothing when it is not present. */
function whenPresent(
	manifest: Manifest,
	sourceId: string,
	lines: readonly string[],
	empty: string,
): readonly string[] {
	return isPresent(manifest, sourceId) ? orEmpty(lines, empty) : [];
}

function turnSection(turn: TurnFacts, context: TurnContext): string {
	const outcome = [
		`status: ${turn.status}`,
		`files edited: ${turn.filesEdited}`,
		`a command failed: ${turn.toolErrored ? "yes" : "no"}`,
	].join("; ");
	const tools = context.tools.map((tool) =>
		tool.failed
			? `- ${tool.name}: FAILED${tool.error ? ` — ${redactSecrets(tool.error)}` : ""}`
			: `- ${tool.name}: ok`,
	);
	const edited = context.editedPaths.map((path) => `- ${redactSecrets(path)}`);
	return section("The turn that just ended", [
		`Outcome — ${outcome}`,
		quoted("What the person asked", context.request),
		quoted("What the agent answered", context.reply),
		tools.length > 0 ? `Tools the agent ran:\n${tools.join("\n")}` : "",
		edited.length > 0 ? `Files the agent edited:\n${edited.join("\n")}` : "",
	]);
}

function factsSection(facts: Facts): string {
	return section(
		redactSecrets(facts.heading),
		facts.lines.map((line) => `- ${redactSecrets(line)}`),
	);
}

/** Sources that exist here but could not be read: unknown in the manifest, or facts that timed out. */
export function unreadSources(
	manifest: Manifest,
	facts: PlannerInputArgs["facts"],
): string[] {
	return Object.entries(manifest.sources)
		.filter(([id, state]) => state === "unknown" || facts[id] === "unknown")
		.map(([id]) => id)
		.sort();
}

export function buildPlannerInput(args: PlannerInputArgs): PlannerInput {
	const { backlog, manifest, facts } = args;
	const plan = isPresent(manifest, "plan");
	const tasks = rankTasks(backlog.tasks).slice(0, TRACKED_LIMIT).map(taskLine);
	const sourceSections = Object.values(facts)
		.filter((value): value is Facts => value !== "unknown")
		.map(factsSection);
	const capabilities = manifest.capabilities.filter(
		(tag) => !tag.startsWith("remote:"),
	);
	const sections = [
		turnSection(args.turn, args.context),
		section(
			"This chat on the Status Hub",
			whenPresent(
				manifest,
				"status",
				backlog.statusRows.map(statusLine),
				"Nothing reported for this chat.",
			),
		),
		section(
			"Other agents on the Status Hub",
			isPresent(manifest, "status")
				? backlog.otherStatusRows.map(otherStatusLine)
				: [],
		),
		section(
			"Tasks on the agenda",
			whenPresent(manifest, "tasks", tasks, "No open tasks."),
		),
		section(
			"The plan this chat's work is linked to",
			plan
				? orEmpty(
						backlog.plan.map(planLine),
						"Nothing in the plan is linked to this chat's work.",
					)
				: [],
		),
		section(
			"The plan bank",
			plan ? orEmpty(bankLines(backlog), "No current or next step.") : [],
		),
		...sourceSections,
		section(
			"Connected services the agent can use (names only)",
			capabilities.length > 0 ? [capabilities.join(", ")] : [],
		),
		section(
			"Could not read just now",
			unreadSources(manifest, facts).map(
				(id) => `- ${args.names[id] ?? id} — treat as unknown, not empty.`,
			),
		),
		section(
			"Already offered or skipped — do not repeat or rephrase these",
			args.excluded.map((prompt) => `- ${redactSecrets(prompt)}`),
		),
	];
	return {
		system: plannerSystemPrompt(args.kinds, manifest.mode),
		user: sections.filter((part) => part.length > 0).join("\n\n"),
	};
}
