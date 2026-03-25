import type { AgentResult, TeamEvent } from "@clinebot/agents";
import { formatUserInputBlock } from "@clinebot/shared";
import {
	buildTeamProgressSummary,
	toTeamProgressLifecycleEvent,
} from "../team";
import type { CoreSessionEvent } from "../types/events";
import type { ActiveSession, TeamRunUpdate } from "./utils/types";

export function trackTeamRunState(
	session: ActiveSession,
	event: TeamEvent,
): void {
	switch (event.type) {
		case "run_queued":
		case "run_started":
			session.activeTeamRunIds.add(event.run.id);
			break;
		case "run_completed":
		case "run_failed":
		case "run_cancelled":
		case "run_interrupted": {
			let runError: string | undefined;
			if (event.type === "run_failed") {
				runError = event.run.error;
			} else if (
				event.type === "run_cancelled" ||
				event.type === "run_interrupted"
			) {
				runError = event.run.error ?? event.reason;
			}
			session.activeTeamRunIds.delete(event.run.id);
			session.pendingTeamRunUpdates.push({
				runId: event.run.id,
				agentId: event.run.agentId,
				taskId: event.run.taskId,
				status: event.type.replace("run_", "") as TeamRunUpdate["status"],
				error: runError,
				iterations: event.run.result?.iterations,
			});
			notifyTeamRunWaiters(session);
			break;
		}
		default:
			break;
	}
}

export async function dispatchTeamEventToBackend(
	rootSessionId: string,
	event: TeamEvent,
	invokeOptional: (method: string, ...args: unknown[]) => Promise<void>,
): Promise<void> {
	switch (event.type) {
		case "run_progress":
			await invokeOptional(
				"onTeamTaskProgress",
				rootSessionId,
				event.run.agentId,
				event.message,
				{ kind: event.message === "heartbeat" ? "heartbeat" : "progress" },
			);
			break;
		case "agent_event":
			if (
				event.event.type === "content_start" &&
				event.event.contentType === "text" &&
				typeof event.event.text === "string"
			) {
				const snippet = event.event.text
					.replace(/\s+/g, " ")
					.trim()
					.slice(0, 120);
				if (snippet) {
					await invokeOptional(
						"onTeamTaskProgress",
						rootSessionId,
						event.agentId,
						snippet,
						{ kind: "text" },
					);
				}
			}
			break;
		case "task_start":
			await invokeOptional(
				"onTeamTaskStart",
				rootSessionId,
				event.agentId,
				event.message,
			);
			break;
		case "task_end": {
			if (event.error) {
				await invokeOptional(
					"onTeamTaskEnd",
					rootSessionId,
					event.agentId,
					"failed",
					`[error] ${event.error.message}`,
					event.messages,
				);
			} else if (event.result?.finishReason === "aborted") {
				await invokeOptional(
					"onTeamTaskEnd",
					rootSessionId,
					event.agentId,
					"cancelled",
					"[done] aborted",
					event.result.messages,
				);
			} else {
				await invokeOptional(
					"onTeamTaskEnd",
					rootSessionId,
					event.agentId,
					"completed",
					`[done] ${event.result?.finishReason ?? "completed"}`,
					event.result?.messages,
				);
			}
			break;
		}
		default:
			break;
	}
}

export function emitTeamProgress(
	session: ActiveSession,
	rootSessionId: string,
	event: TeamEvent,
	emit: (event: CoreSessionEvent) => void,
): void {
	if (!session.runtime.teamRuntime) return;
	const teamName = session.config.teamName?.trim() || "team";
	emit({
		type: "team_progress",
		payload: {
			sessionId: rootSessionId,
			teamName,
			lifecycle: toTeamProgressLifecycleEvent({
				teamName,
				sessionId: rootSessionId,
				event,
			}),
			summary: buildTeamProgressSummary(
				teamName,
				session.runtime.teamRuntime.exportState(),
			),
		},
	});
}

export function hasPendingTeamRunWork(session: ActiveSession): boolean {
	return (
		session.activeTeamRunIds.size > 0 ||
		session.pendingTeamRunUpdates.length > 0
	);
}

export function shouldAutoContinueTeamRuns(
	session: ActiveSession,
	finishReason: AgentResult["finishReason"],
): boolean {
	if (session.aborting) {
		return false;
	}
	const canAutoContinue =
		finishReason === "completed" || finishReason === "max_iterations";
	if (!canAutoContinue) {
		return false;
	}
	return (
		session.config.enableAgentTeams === true && hasPendingTeamRunWork(session)
	);
}

export function notifyTeamRunWaiters(session: ActiveSession): void {
	const waiters = session.teamRunWaiters.splice(0);
	for (const resolve of waiters) resolve();
}

export async function waitForTeamRunUpdates(
	session: ActiveSession,
): Promise<TeamRunUpdate[]> {
	while (true) {
		if (session.aborting) return [];
		if (session.pendingTeamRunUpdates.length > 0) {
			const updates = [...session.pendingTeamRunUpdates];
			session.pendingTeamRunUpdates.length = 0;
			return updates;
		}
		if (session.activeTeamRunIds.size === 0) return [];
		await new Promise<void>((resolve) => {
			session.teamRunWaiters.push(resolve);
		});
	}
}

export function buildTeamRunContinuationPrompt(
	session: ActiveSession,
	updates: TeamRunUpdate[],
): string {
	const lines = updates.map((u) => {
		const parts = [`- ${u.runId} (${u.agentId}) -> ${u.status}`];
		if (u.taskId) parts.push(` task=${u.taskId}`);
		if (typeof u.iterations === "number")
			parts.push(` iterations=${u.iterations}`);
		if (u.error) parts.push(` error=${u.error}`);
		return parts.join("");
	});
	const remaining = session.activeTeamRunIds.size;
	const instruction =
		remaining > 0
			? `There are still ${remaining} teammate run(s) in progress. Continue coordination and decide whether to wait for more updates.`
			: "No teammate runs are currently in progress. Continue coordination using these updates.";
	return formatModePrompt(
		`System-delivered teammate async run updates:\n${lines.join("\n")}\n\n${instruction}`,
		session.config.mode,
	);
}

export function formatModePrompt(
	prompt: string,
	mode: "act" | "plan" | undefined,
): string {
	return formatUserInputBlock(prompt, mode === "plan" ? "plan" : "act");
}
