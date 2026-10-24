import type { TeamProgressLifecycleEvent } from "@cline/shared";

/**
 * What each teammate of an agent team is doing right now, for
 * {@link AgentTeamPanel}.
 *
 * Two sources feed it. The persisted roster of child sessions knows each
 * teammate's runs, their real status, and the last thing each transcript did,
 * but hosts usually poll it. `team_progress` lifecycle events arrive as the
 * team works and name the tool a run is executing, so they take over whenever
 * they are newer.
 */

/** One persisted teammate run, as a host's session roster reports it. */
export type AgentTeamRun = {
	agentId: string;
	/** The run's own child session, which a member row opens. */
	sessionId: string;
	/** Team-task runs are teammates; anything else (e.g. subagents) is ignored. */
	kind: "teamtask" | "subagent";
	/** Persisted session status: running, pending, completed, failed, cancelled, idle. */
	status: string;
	/** The task the run was given, usually its first prompt. */
	prompt?: string;
	/** Most recent step: assistant text, or `Running <tool>` for a tool call. */
	lastAction?: string;
	/** ISO timestamps. */
	startedAt: string;
	endedAt?: string;
};

export type AgentTeamMemberPhase =
	| "thinking"
	| "reading"
	| "editing"
	| "running"
	| "coordinating"
	| "waiting"
	| "done"
	| "failed"
	| "stopped";

export type AgentTeamMember = {
	agentId: string;
	/** The teammate's latest run, which is the session its row opens. */
	sessionId: string;
	task?: string;
	phase: AgentTeamMemberPhase;
	step?: string;
	/** Epoch ms. */
	startedAt: number;
	endedAt?: number;
};

/** Latest live activity for one agent, from a `team_progress` lifecycle event. */
export type AgentTeamLiveActivity = {
	eventType: string;
	message?: string;
	/** Epoch ms the event was observed. */
	at: number;
};

export type AgentTeamPhaseBucket =
	| "planning"
	| "acting"
	| "waiting"
	| "done"
	| "failed";

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

export function agentTeamPhaseForTool(toolName: string): AgentTeamMemberPhase {
	const name = toolName.trim().toLowerCase();
	if (READ_TOOLS.has(name)) return "reading";
	if (EDIT_TOOLS.has(name)) return "editing";
	if (RUN_TOOLS.has(name)) return "running";
	if (name === "team_await_runs") return "waiting";
	if (name.startsWith("team_") || name === "spawn_agent") return "coordinating";
	return "running";
}

export function agentTeamStepForTool(toolName: string): string {
	const name = toolName.trim().toLowerCase();
	return TOOL_STEP[name] ?? `Running ${name}`;
}

const LAST_ACTION_TOOL_PREFIX = "Running ";
// Tool starts and ends are both reported, and a throttled stream may only
// deliver the end, so either names what the teammate is working on.
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

/** Live activity for a `team_progress` lifecycle event, or undefined without an agent. */
export function agentTeamLiveActivityFromLifecycle(
	lifecycle: Pick<
		TeamProgressLifecycleEvent,
		"agentId" | "eventType" | "message"
	>,
	at: number = Date.now(),
): (AgentTeamLiveActivity & { agentId: string }) | undefined {
	if (!lifecycle.agentId || !lifecycle.eventType) return undefined;
	return {
		agentId: lifecycle.agentId,
		eventType: lifecycle.eventType,
		message: lifecycle.message,
		at,
	};
}

/** Phase implied by a live event, or undefined when it says nothing new. */
export function agentTeamPhaseFromLiveActivity(
	live: AgentTeamLiveActivity,
): { phase: AgentTeamMemberPhase; step?: string } | undefined {
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
			if (tool) {
				return {
					phase: agentTeamPhaseForTool(tool),
					step: agentTeamStepForTool(tool),
				};
			}
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
	// A teammate task's child session is created and settled at these; for a
	// synchronous task they are the only boundaries reported.
	"task_start",
	"task_end",
	"run_queued",
	"run_started",
	"run_completed",
	"run_failed",
	"run_cancelled",
	"run_interrupted",
]);

/**
 * Whether a live event means the persisted roster changed: a teammate joined or
 * left, or one of its runs started or ended. Hosts that poll the roster only
 * while the lead looks busy should re-read it on these, or they miss runs a
 * lead starts while its own turn is idle.
 */
export function changesAgentTeamRoster(eventType: string): boolean {
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
export function shouldReplaceAgentTeamLiveActivity(
	previous: AgentTeamLiveActivity | undefined,
	next: AgentTeamLiveActivity,
): boolean {
	if (!agentTeamPhaseFromLiveActivity(next)) return false;
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

function settledPhase(status: string): AgentTeamMemberPhase | undefined {
	switch (status.trim().toLowerCase()) {
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
 * One member per teammate, built from its team-task runs. A teammate that ran
 * several tasks is shown by its latest run, timed from its first.
 */
export function buildAgentTeamMembers(
	runs: readonly AgentTeamRun[],
	live: ReadonlyMap<string, AgentTeamLiveActivity> = new Map(),
): AgentTeamMember[] {
	const runsByAgent = new Map<string, AgentTeamRun[]>();
	for (const run of runs) {
		if (run.kind !== "teamtask") continue;
		const agentRuns = runsByAgent.get(run.agentId) ?? [];
		agentRuns.push(run);
		runsByAgent.set(run.agentId, agentRuns);
	}

	const members: AgentTeamMember[] = [];
	for (const [agentId, agentRuns] of runsByAgent) {
		agentRuns.sort(
			(a, b) => (parseTime(a.startedAt) ?? 0) - (parseTime(b.startedAt) ?? 0),
		);
		const latest = agentRuns[agentRuns.length - 1];
		if (!latest) continue;
		const startedAt = parseTime(agentRuns[0]?.startedAt) ?? Date.now();
		const settled = settledPhase(latest.status);
		const lastAction = latest.lastAction?.trim() || undefined;
		const lastActionTool = toolFromLastAction(lastAction);
		// Narration reads better than a tool name, so it stays as the step even
		// when a newer live event decides the phase.
		const narration = lastAction && !lastActionTool ? lastAction : undefined;

		let phase: AgentTeamMemberPhase =
			settled ??
			(lastActionTool ? agentTeamPhaseForTool(lastActionTool) : "thinking");
		let step =
			narration ?? (lastActionTool && agentTeamStepForTool(lastActionTool));

		const liveActivity = live.get(agentId);
		const latestStartedAt = parseTime(latest.startedAt) ?? startedAt;
		if (!settled && liveActivity && liveActivity.at >= latestStartedAt) {
			const fromLive = agentTeamPhaseFromLiveActivity(liveActivity);
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

export function agentTeamPhaseBucket(
	phase: AgentTeamMemberPhase,
): AgentTeamPhaseBucket {
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
export function summarizeAgentTeam(
	members: readonly AgentTeamMember[],
): string {
	const order: AgentTeamPhaseBucket[] = [
		"planning",
		"acting",
		"waiting",
		"done",
		"failed",
	];
	const counts = new Map<AgentTeamPhaseBucket, number>();
	for (const member of members) {
		const bucket = agentTeamPhaseBucket(member.phase);
		counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
	}
	return order
		.filter((bucket) => (counts.get(bucket) ?? 0) > 0)
		.map((bucket) => `${counts.get(bucket)} ${bucket}`)
		.join(" · ");
}

export function isAgentTeamSettled(
	members: readonly AgentTeamMember[],
): boolean {
	return (
		members.length > 0 &&
		members.every((member) => {
			const bucket = agentTeamPhaseBucket(member.phase);
			return bucket === "done" || bucket === "failed";
		})
	);
}
