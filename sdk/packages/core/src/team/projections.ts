import type {
	TeamProgressLifecycleEvent,
	TeamProgressSummary,
} from "@clinebot/shared";
import type {
	TeamEvent,
	TeamOutcome,
	TeamOutcomeFragment,
	TeamRuntimeState,
} from "./runtime";

function toIsoNow(): string {
	return new Date().toISOString();
}

function pct(numerator: number, denominator: number): number {
	if (denominator <= 0) {
		return 0;
	}
	return Math.round((numerator / denominator) * 100);
}

function collectMissingRequiredSections(
	outcomes: TeamOutcome[],
	fragments: TeamOutcomeFragment[],
): string[] {
	const approvedSections = new Set<string>();
	for (const fragment of fragments) {
		if (fragment.status === "reviewed") {
			approvedSections.add(`${fragment.outcomeId}:${fragment.section}`);
		}
	}
	const missing = new Set<string>();
	for (const outcome of outcomes) {
		if (outcome.status === "finalized") {
			continue;
		}
		for (const section of outcome.requiredSections) {
			if (!approvedSections.has(`${outcome.id}:${section}`)) {
				missing.add(`${outcome.id}:${section}`);
			}
		}
	}
	return [...missing].sort((a, b) => a.localeCompare(b));
}

export function buildTeamProgressSummary(
	teamName: string,
	state: TeamRuntimeState,
): TeamProgressSummary {
	const membersByStatus: Record<"idle" | "running" | "stopped", number> = {
		idle: 0,
		running: 0,
		stopped: 0,
	};
	const tasksByStatus: Record<
		"pending" | "in_progress" | "blocked" | "completed",
		number
	> = {
		pending: 0,
		in_progress: 0,
		blocked: 0,
		completed: 0,
	};
	const runsByStatus: Record<
		"queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted",
		number
	> = {
		queued: 0,
		running: 0,
		completed: 0,
		failed: 0,
		cancelled: 0,
		interrupted: 0,
	};
	const outcomesByStatus: Record<"draft" | "in_review" | "finalized", number> =
		{
			draft: 0,
			in_review: 0,
			finalized: 0,
		};
	const fragmentsByStatus: Record<"draft" | "reviewed" | "rejected", number> = {
		draft: 0,
		reviewed: 0,
		rejected: 0,
	};

	let leadCount = 0;
	let teammateCount = 0;
	for (const member of state.members) {
		membersByStatus[member.status] += 1;
		if (member.role === "lead") {
			leadCount += 1;
		} else {
			teammateCount += 1;
		}
	}

	const blockedTaskIds: string[] = [];
	const readyTaskIds: string[] = [];
	const completedTaskCount = state.tasks.filter(
		(task) => task.status === "completed",
	).length;
	const taskById = new Map(state.tasks.map((task) => [task.id, task] as const));
	for (const task of state.tasks) {
		tasksByStatus[task.status] += 1;
		if (task.status === "blocked") {
			blockedTaskIds.push(task.id);
			continue;
		}
		if (task.status !== "pending") {
			continue;
		}
		const depsSatisfied = task.dependsOn.every((depId) => {
			const dependency = taskById.get(depId);
			return dependency?.status === "completed";
		});
		if (depsSatisfied) {
			readyTaskIds.push(task.id);
		}
	}

	const activeRunIds: string[] = [];
	let latestRunId: string | undefined;
	let latestRunTs = 0;
	for (const run of state.runs) {
		runsByStatus[run.status] += 1;
		if (run.status === "queued" || run.status === "running") {
			activeRunIds.push(run.id);
		}
		const startedAtTs = run.startedAt.getTime();
		if (startedAtTs >= latestRunTs) {
			latestRunTs = startedAtTs;
			latestRunId = run.id;
		}
	}

	for (const outcome of state.outcomes) {
		outcomesByStatus[outcome.status] += 1;
	}
	for (const fragment of state.outcomeFragments) {
		fragmentsByStatus[fragment.status] += 1;
	}

	return {
		teamName,
		updatedAt: toIsoNow(),
		members: {
			total: state.members.length,
			byStatus: membersByStatus,
			leadCount,
			teammateCount,
		},
		tasks: {
			total: state.tasks.length,
			byStatus: tasksByStatus,
			blockedTaskIds,
			readyTaskIds,
			completionPct: pct(completedTaskCount, state.tasks.length),
		},
		runs: {
			total: state.runs.length,
			byStatus: runsByStatus,
			activeRunIds,
			latestRunId,
		},
		outcomes: {
			total: state.outcomes.length,
			byStatus: outcomesByStatus,
			finalizedPct: pct(outcomesByStatus.finalized, state.outcomes.length),
			missingRequiredSections: collectMissingRequiredSections(
				state.outcomes,
				state.outcomeFragments,
			),
		},
		fragments: {
			total: state.outcomeFragments.length,
			byStatus: fragmentsByStatus,
		},
	};
}

export function toTeamProgressLifecycleEvent(input: {
	teamName: string;
	sessionId: string;
	event: TeamEvent;
}): TeamProgressLifecycleEvent {
	const { event } = input;
	switch (event.type) {
		case "team_task_updated":
			return {
				teamName: input.teamName,
				sessionId: input.sessionId,
				eventType: event.type,
				ts: toIsoNow(),
				taskId: event.task.id,
				agentId: event.task.assignee ?? event.task.createdBy,
			};
		case "run_queued":
		case "run_started":
		case "run_completed":
		case "run_failed":
		case "run_cancelled":
		case "run_interrupted":
			return {
				teamName: input.teamName,
				sessionId: input.sessionId,
				eventType: event.type,
				ts: toIsoNow(),
				runId: event.run.id,
				taskId: event.run.taskId,
				agentId: event.run.agentId,
				message: event.run.error,
			};
		case "run_progress":
			return {
				teamName: input.teamName,
				sessionId: input.sessionId,
				eventType: event.type,
				ts: toIsoNow(),
				runId: event.run.id,
				taskId: event.run.taskId,
				agentId: event.run.agentId,
				message: event.message,
			};
		case "outcome_created":
		case "outcome_finalized":
			return {
				teamName: input.teamName,
				sessionId: input.sessionId,
				eventType: event.type,
				ts: toIsoNow(),
				outcomeId: event.outcome.id,
			};
		case "outcome_fragment_attached":
		case "outcome_fragment_reviewed":
			return {
				teamName: input.teamName,
				sessionId: input.sessionId,
				eventType: event.type,
				ts: toIsoNow(),
				outcomeId: event.fragment.outcomeId,
				fragmentId: event.fragment.id,
				agentId: event.fragment.sourceAgentId,
			};
		case "team_message":
			return {
				teamName: input.teamName,
				sessionId: input.sessionId,
				eventType: event.type,
				ts: toIsoNow(),
				taskId: event.message.taskId,
				agentId: event.message.fromAgentId,
				message: event.message.subject,
			};
		case "team_mission_log":
			return {
				teamName: input.teamName,
				sessionId: input.sessionId,
				eventType: event.type,
				ts: toIsoNow(),
				taskId: event.entry.taskId,
				agentId: event.entry.agentId,
				message: event.entry.summary,
			};
		case "teammate_spawned":
		case "teammate_shutdown":
		case "task_start":
		case "task_end":
		case "agent_event":
			return {
				teamName: input.teamName,
				sessionId: input.sessionId,
				eventType: event.type,
				ts: toIsoNow(),
				agentId: event.agentId,
			};
	}
	return {
		teamName: input.teamName,
		sessionId: input.sessionId,
		eventType: (event as TeamEvent).type,
		ts: toIsoNow(),
	};
}
