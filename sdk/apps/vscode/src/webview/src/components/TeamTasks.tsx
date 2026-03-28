"use client";

import { UsersIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import {
	Task,
	TaskContent,
	TaskItem,
	TaskTrigger,
} from "@/components/ai-elements/task";

export type TeamToolEvent = {
	id: string;
	name: string;
	state: "input-available" | "output-available" | "output-error";
	input?: unknown;
	output?: unknown;
	error?: string;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: undefined;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: undefined;
}

function prefixForState(state: TeamToolEvent["state"]): string {
	if (state === "output-error") {
		return "Failed";
	}
	if (state === "output-available") {
		return "Done";
	}
	return "Running";
}

function summarizeTeamTool(event: TeamToolEvent): ReactNode {
	const input = asRecord(event.input);
	const output = asRecord(event.output);
	const statePrefix = prefixForState(event.state);

	switch (event.name) {
		case "team_spawn_teammate":
			return `${statePrefix} spawn teammate ${asString(input?.agentId) ?? asString(output?.agentId) ?? "agent"}`;
		case "team_shutdown_teammate":
			return `${statePrefix} shutdown teammate ${asString(input?.agentId) ?? asString(output?.agentId) ?? "agent"}`;
		case "team_status":
			return `${statePrefix} fetch team status`;
		case "team_task": {
			const action = asString(input?.action);
			if (action === "create") {
				return `${statePrefix} create task ${asString(output?.taskId) ?? ""}${asString(input?.title) ? `: ${asString(input?.title)}` : ""}`.trim();
			}
			if (action === "list") {
				return `${statePrefix} list team tasks`;
			}
			if (action === "claim") {
				return `${statePrefix} claim task ${asString(input?.taskId) ?? asString(output?.taskId) ?? ""}`.trim();
			}
			if (action === "complete") {
				return `${statePrefix} complete task ${asString(input?.taskId) ?? asString(output?.taskId) ?? ""}`.trim();
			}
			if (action === "block") {
				return `${statePrefix} block task ${asString(input?.taskId) ?? asString(output?.taskId) ?? ""}`.trim();
			}
			return `${statePrefix} update team task`;
		}
		case "team_run_task": {
			const agentId =
				asString(input?.agentId) ?? asString(output?.agentId) ?? "agent";
			const mode = asString(output?.mode) ?? asString(input?.runMode);
			const task = asString(input?.task);
			const suffix = task ? `: ${task}` : "";
			return `${statePrefix} ${mode === "async" ? "queue" : "run"} task with ${agentId}${suffix}`;
		}
		case "team_cancel_run":
			return `${statePrefix} cancel run ${asString(input?.runId) ?? asString(output?.runId) ?? ""}`.trim();
		case "team_list_runs":
			return `${statePrefix} list teammate runs`;
		case "team_await_run":
			return `${statePrefix} await run ${asString(input?.runId) ?? ""}`.trim();
		case "team_await_all_runs":
			return `${statePrefix} await all active runs`;
		case "team_send_message":
			return `${statePrefix} message ${asString(input?.toAgentId) ?? asString(output?.toAgentId) ?? "agent"}${asString(input?.subject) ? `: ${asString(input?.subject)}` : ""}`;
		case "team_broadcast":
			return `${statePrefix} broadcast${asString(input?.subject) ? `: ${asString(input?.subject)}` : ""}`;
		case "team_read_mailbox":
			return `${statePrefix} read mailbox`;
		case "team_log_update":
			return `${statePrefix} log ${asString(input?.kind) ?? "update"}${asString(input?.summary) ? `: ${asString(input?.summary)}` : ""}`;
		case "team_cleanup":
			return `${statePrefix} clean up team runtime`;
		case "team_create_outcome":
			return `${statePrefix} create outcome${asString(input?.title) ? `: ${asString(input?.title)}` : ""}`;
		case "team_attach_outcome_fragment":
			return `${statePrefix} attach fragment to ${asString(input?.section) ?? "section"}`;
		case "team_review_outcome_fragment":
			return `${statePrefix} ${input?.approved === false ? "reject" : "review"} fragment ${asString(input?.fragmentId) ?? ""}`.trim();
		case "team_finalize_outcome":
			return `${statePrefix} finalize outcome ${asString(input?.outcomeId) ?? asString(output?.outcomeId) ?? ""}`.trim();
		case "team_list_outcomes":
			return `${statePrefix} list outcomes`;
		default:
			return `${statePrefix} ${event.name.replace(/^team_/, "").replaceAll("_", " ")}`;
	}
}

function describeTeamTool(event: TeamToolEvent): string | undefined {
	if (event.error) {
		return event.error;
	}

	const input = asRecord(event.input);
	const output = asRecord(event.output);

	switch (event.name) {
		case "team_task": {
			const action = asString(input?.action);
			if (action === "create") {
				return asString(input?.description);
			}
			if (action === "block") {
				return asString(input?.reason);
			}
			if (action === "list") {
				const tasks = Array.isArray(output?.tasks)
					? output.tasks.length
					: undefined;
				return typeof tasks === "number"
					? `${tasks} task${tasks === 1 ? "" : "s"}`
					: undefined;
			}
			return undefined;
		}
		case "team_run_task":
			return asString(output?.runId) ?? asString(output?.text);
		case "team_send_message":
		case "team_broadcast":
			return asString(input?.body);
		case "team_log_update":
			return asString(input?.nextAction) ?? asString(input?.summary);
		case "team_attach_outcome_fragment":
			return asString(input?.content);
		case "team_status": {
			const members = Array.isArray(output?.members)
				? output.members.length
				: undefined;
			const tasks = Array.isArray(output?.tasks)
				? output.tasks.length
				: undefined;
			const runs = Array.isArray(output?.runs) ? output.runs.length : undefined;
			const parts = [
				typeof members === "number" ? `${members} members` : undefined,
				typeof tasks === "number" ? `${tasks} tasks` : undefined,
				typeof runs === "number" ? `${runs} runs` : undefined,
			].filter(Boolean);
			return parts.join(" • ") || undefined;
		}
		case "team_list_runs": {
			const runs = Array.isArray(event.output) ? event.output : undefined;
			if (!runs?.length) {
				return "No runs";
			}
			return `${runs.length} run${runs.length === 1 ? "" : "s"}`;
		}
		case "team_read_mailbox": {
			const messages = Array.isArray(event.output) ? event.output : undefined;
			if (!messages?.length) {
				return "No messages";
			}
			return `${messages.length} message${messages.length === 1 ? "" : "s"}`;
		}
		case "team_create_outcome": {
			const sections = asStringArray(input?.requiredSections);
			return sections?.length ? sections.join(", ") : undefined;
		}
		default:
			return undefined;
	}
}

export default function TeamTasks({
	className,
	defaultOpen = true,
	events,
	...props
}: Omit<ComponentProps<typeof Task>, "children"> & {
	events: TeamToolEvent[];
}) {
	if (events.length === 0) {
		return null;
	}

	const title =
		events.length === 1 ? "Team activity" : `Team activity (${events.length})`;

	return (
		<Task className={className} defaultOpen={defaultOpen} {...props}>
			<TaskTrigger title={title}>
				<div className="flex w-full cursor-pointer items-center gap-2 text-muted-foreground text-sm transition-colors hover:text-foreground">
					<UsersIcon className="size-4" />
					<p className="text-sm">{title}</p>
				</div>
			</TaskTrigger>
			<TaskContent>
				{events.map((event) => {
					const description = describeTeamTool(event);
					return (
						<TaskItem className="space-y-1" key={event.id}>
							<div>{summarizeTeamTool(event)}</div>
							{description ? (
								<div className="line-clamp-3 text-xs text-muted-foreground/90">
									{description}
								</div>
							) : null}
						</TaskItem>
					);
				})}
			</TaskContent>
		</Task>
	);
}
