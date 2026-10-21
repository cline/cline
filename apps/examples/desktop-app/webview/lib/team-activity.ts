import { agentEntryState, type SessionAgentEntry } from "@/lib/session-agents";

/**
 * What a teammate is doing right now, for the team panel on the chat input.
 *
 * Two sources feed it. The persisted roster (`list_session_agents`) knows each
 * teammate's runs, their real status, and the last thing each transcript did,
 * but it is polled. `team_progress` events arrive as the team works and name
 * the tool a run is executing, so they take over whenever they are newer.
 */

export type TeamMemberPhase =
	| "thinking"
	| "reading"
	| "editing"
	| "running"
	| "coordinating"
	| "waiting"
	| "done"
	| "failed"
	| "stopped";

export type TeamMemberActivity = {
	agentId: string;
	/** The teammate's latest run, which is the session its row opens. */
	sessionId: string;
	task?: string;
	phase: TeamMemberPhase;
	step?: string;
	startedAt: number;
	endedAt?: number;
};

/** Latest live activity per agent, from `team_progress` lifecycle events. */
export type TeamLiveActivity = {
	eventType: string;
	message?: string;
	/** Epoch ms the event was observed. */
	at: number;
};

const READ_TOOLS = new Set([
	"read_files",
	"read_file",
	"search_codebase",
	"search_files",
	"list_files",
	"fetch_web_content",
	"web_fetch",
	"web_search",
	"skills",
]);
const EDIT_TOOLS = new Set([
	"editor",
	"apply_patch",
	"write_file",
	"write_to_file",
	"replace_in_file",
]);
const RUN_TOOLS = new Set(["run_commands", "bash", "execute_command"]);

const TOOL_STEP: Record<string, string> = {
	read_files: "Reading files",
	read_file: "Reading files",
	search_codebase: "Searching the codebase",
	search_files: "Searching the codebase",
	list_files: "Listing files",
	fetch_web_content: "Reading the web",
	web_fetch: "Reading the web",
	web_search: "Searching the web",
	editor: "Editing files",
	apply_patch: "Editing files",
	write_file: "Writing files",
	write_to_file: "Writing files",
	replace_in_file: "Editing files",
	run_commands: "Running commands",
	bash: "Running commands",
	execute_command: "Running commands",
	team_send_message: "Messaging a teammate",
	team_broadcast: "Messaging the team",
	team_read_mailbox: "Reading team messages",
	team_task: "Updating team tasks",
	team_await_runs: "Waiting on teammates",
	spawn_agent: "Delegating to a subagent",
};

export function phaseForTool(toolName: string): TeamMemberPhase {
	const name = toolName.trim().toLowerCase();
	if (READ_TOOLS.has(name)) return "reading";
	if (EDIT_TOOLS.has(name)) return "editing";
	if (RUN_TOOLS.has(name)) return "running";
	if (name === "team_await_runs") return "waiting";
	if (name.startsWith("team_") || name === "spawn_agent") return "coordinating";
	return "running";
}

export function stepForTool(toolName: string): string {
	const name = toolName.trim().toLowerCase();
	return TOOL_STEP[name] ?? `Running ${name}`;
}

const LAST_ACTION_TOOL_PREFIX = "Running ";
// Tool starts and ends are both reported, and the throttled stream often only
// delivers the end, so either names what the teammate is working on.
const TOOL_ACTIVITY =
	/^(?:running_tool_|finished_tool_)([\w.-]+)$|^tool_([\w.-]+?)_error/;

/** Tool named by a `run_progress` activity such as `running_tool_editor`. */
function toolFromActivity(message?: string): string | undefined {
	const match = message ? TOOL_ACTIVITY.exec(message) : null;
	const tool = match?.[1] ?? match?.[2];
	return tool && tool !== "unknown" ? tool : undefined;
}

/** Tool named by a roster `lastAction` such as `Running read_files`. */
function toolFromLastAction(lastAction?: string): string | undefined {
	if (!lastAction?.startsWith(LAST_ACTION_TOOL_PREFIX)) return undefined;
	const tool = lastAction.slice(LAST_ACTION_TOOL_PREFIX.length).trim();
	return /^[\w.-]+$/.test(tool) ? tool : undefined;
}

/** Phase implied by a live event, or undefined when it says nothing new. */
export function phaseFromLiveActivity(
	live: TeamLiveActivity,
): { phase: TeamMemberPhase; step?: string } | undefined {
	switch (live.eventType) {
		case "run_queued":
			return { phase: "waiting", step: "Queued" };
		case "run_started":
			return { phase: "thinking" };
		case "run_completed":
			return { phase: "done" };
		case "run_failed":
			return { phase: "failed", step: live.message };
		case "run_cancelled":
		case "run_interrupted":
			return { phase: "stopped" };
		case "team_message":
			return {
				phase: "coordinating",
				step: live.message ? `Sent “${live.message}”` : undefined,
			};
		case "run_progress": {
			const tool = toolFromActivity(live.message);
			if (tool) return { phase: phaseForTool(tool), step: stepForTool(tool) };
			if (live.message?.startsWith("iteration_")) return { phase: "thinking" };
			if (live.message === "finalizing_response") {
				return { phase: "thinking", step: "Wrapping up" };
			}
			return undefined;
		}
		default:
			return undefined;
	}
}

const ROSTER_EVENTS = new Set([
	"teammate_spawned",
	"teammate_shutdown",
	"run_queued",
	"run_started",
	"run_completed",
	"run_failed",
	"run_cancelled",
	"run_interrupted",
]);

/**
 * Whether a live event means the persisted roster changed: a teammate joined or
 * left, or one of its runs started or ended. The roster is otherwise only
 * polled while the lead looks busy, which misses runs a lead starts while its
 * own turn is idle.
 */
export function changesTeamRoster(eventType: string): boolean {
	return ROSTER_EVENTS.has(eventType);
}

/**
 * Whether a new live event should replace the one kept for an agent. Model turns
 * take seconds while tools take milliseconds, so every tool's activity is
 * followed at once by the next iteration starting; letting that overwrite it
 * would show nearly every teammate as thinking. A teammate keeps its latest
 * kind of work until it does something else, and anything uninterpretable is
 * ignored.
 */
export function shouldReplaceLiveActivity(
	previous: TeamLiveActivity | undefined,
	next: TeamLiveActivity,
): boolean {
	if (!phaseFromLiveActivity(next)) return false;
	const isIteration =
		next.eventType === "run_progress" &&
		Boolean(next.message?.startsWith("iteration_"));
	if (!isIteration || !previous) return true;
	return !toolFromActivity(previous.message);
}

/** Team task prompts are often multi-line briefs; the first line is the task. */
function firstLine(value?: string): string | undefined {
	const line = value
		?.split("\n")
		.map((part) => part.trim())
		.find(Boolean);
	return line || undefined;
}

function parseTime(value?: string): number | undefined {
	if (!value) return undefined;
	const time = Date.parse(value);
	return Number.isFinite(time) ? time : undefined;
}

function settledPhase(status: string): TeamMemberPhase | undefined {
	switch (agentEntryState(status)) {
		case "completed":
			return "done";
		case "failed":
			return "failed";
		case "cancelled":
			return "stopped";
		default:
			return undefined;
	}
}

/**
 * One row per teammate, built from its team-task runs. A teammate that ran
 * several tasks is shown by its latest run, timed from its first.
 */
export function buildTeamMembers(
	agents: SessionAgentEntry[],
	live: ReadonlyMap<string, TeamLiveActivity> = new Map(),
): TeamMemberActivity[] {
	const runsByAgent = new Map<string, SessionAgentEntry[]>();
	for (const agent of agents) {
		if (agent.kind !== "teamtask") continue;
		const runs = runsByAgent.get(agent.agentId) ?? [];
		runs.push(agent);
		runsByAgent.set(agent.agentId, runs);
	}

	const members: TeamMemberActivity[] = [];
	for (const [agentId, runs] of runsByAgent) {
		runs.sort(
			(a, b) => (parseTime(a.startedAt) ?? 0) - (parseTime(b.startedAt) ?? 0),
		);
		const latest = runs[runs.length - 1];
		if (!latest) continue;
		const startedAt = parseTime(runs[0]?.startedAt) ?? Date.now();
		const settled = settledPhase(latest.status);
		const lastAction = latest.lastAction?.trim() || undefined;
		const lastActionTool = toolFromLastAction(lastAction);
		// Narration reads better than a tool name, so it stays as the step even
		// when a newer live event decides the phase.
		const narration = lastAction && !lastActionTool ? lastAction : undefined;

		let phase: TeamMemberPhase =
			settled ?? (lastActionTool ? phaseForTool(lastActionTool) : "thinking");
		let step = narration ?? (lastActionTool && stepForTool(lastActionTool));

		const liveActivity = live.get(agentId);
		const latestStartedAt = parseTime(latest.startedAt) ?? startedAt;
		if (!settled && liveActivity && liveActivity.at >= latestStartedAt) {
			const fromLive = phaseFromLiveActivity(liveActivity);
			if (fromLive) {
				phase = fromLive.phase;
				step = narration ?? fromLive.step ?? step;
			}
		}

		members.push({
			agentId,
			sessionId: latest.sessionId,
			task: firstLine(latest.prompt),
			phase,
			step: phase === "done" ? undefined : step,
			startedAt,
			endedAt: settled ? parseTime(latest.endedAt) : undefined,
		});
	}
	return members.sort((a, b) => a.startedAt - b.startedAt);
}

export type TeamPhaseBucket =
	| "planning"
	| "acting"
	| "waiting"
	| "done"
	| "failed";

export function phaseBucket(phase: TeamMemberPhase): TeamPhaseBucket {
	switch (phase) {
		case "thinking":
		case "reading":
			return "planning";
		case "editing":
		case "running":
		case "coordinating":
			return "acting";
		case "waiting":
			return "waiting";
		case "done":
			return "done";
		case "failed":
		case "stopped":
			return "failed";
	}
}

/** "2 planning · 3 acting · 1 done", omitting empty buckets. */
export function summarizeTeam(members: TeamMemberActivity[]): string {
	const order: TeamPhaseBucket[] = [
		"planning",
		"acting",
		"waiting",
		"done",
		"failed",
	];
	const counts = new Map<TeamPhaseBucket, number>();
	for (const member of members) {
		const bucket = phaseBucket(member.phase);
		counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
	}
	return order
		.filter((bucket) => (counts.get(bucket) ?? 0) > 0)
		.map((bucket) => `${counts.get(bucket)} ${bucket}`)
		.join(" · ");
}

export function isTeamSettled(members: TeamMemberActivity[]): boolean {
	return (
		members.length > 0 &&
		members.every((member) => {
			const bucket = phaseBucket(member.phase);
			return bucket === "done" || bucket === "failed";
		})
	);
}
