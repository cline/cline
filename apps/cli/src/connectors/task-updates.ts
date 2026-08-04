import type { HubSessionClient } from "@cline/core";
import type { TeamProgressProjectionEvent } from "@cline/shared";
import type { Chat, Thread } from "chat";
import type { CliLoggerAdapter } from "../logging/adapter";
import { truncateConnectorText } from "./runtime-turn";
import {
	type ConnectorThreadBinding,
	type ConnectorThreadState,
	readBindings,
} from "./thread-bindings";

function formatCountLabel(input: {
	count: number;
	singular: string;
	plural: string;
}): string {
	return `${input.count} ${input.count === 1 ? input.singular : input.plural}`;
}

function buildProgressSummary(event: TeamProgressProjectionEvent): string {
	const activeRuns = event.summary.runs.byStatus.running;
	const activeTasks = event.summary.tasks.byStatus.in_progress;
	const blockedTasks = event.summary.tasks.byStatus.blocked;
	const completedTasks = event.summary.tasks.byStatus.completed;
	const totalTasks = event.summary.tasks.total;
	const parts = [
		formatCountLabel({
			count: activeRuns,
			singular: "run active",
			plural: "runs active",
		}),
		formatCountLabel({
			count: activeTasks,
			singular: "task in progress",
			plural: "tasks in progress",
		}),
	];
	if (blockedTasks > 0) {
		parts.push(
			formatCountLabel({
				count: blockedTasks,
				singular: "blocked task",
				plural: "blocked tasks",
			}),
		);
	}
	if (totalTasks > 0) {
		parts.push(`${completedTasks}/${totalTasks} tasks complete`);
	}
	return parts.join(" | ");
}

export function formatConnectorTaskUpdate(
	event: TeamProgressProjectionEvent,
): string | undefined {
	const message = event.lastEvent.message
		? truncateConnectorText(event.lastEvent.message, 220)
		: undefined;
	const teamName = event.summary.teamName;
	switch (event.lastEvent.eventType) {
		case "run_started":
			return [
				`[${teamName}] Task started`,
				buildProgressSummary(event),
				message,
			]
				.filter(Boolean)
				.join("\n");
		case "run_progress":
			return [
				`[${teamName}] Task update`,
				message ?? buildProgressSummary(event),
				message ? buildProgressSummary(event) : undefined,
			]
				.filter(Boolean)
				.join("\n");
		case "run_completed":
			return [`[${teamName}] Task completed`, buildProgressSummary(event)]
				.filter(Boolean)
				.join("\n");
		case "run_failed":
			return [`[${teamName}] Task failed`, message, buildProgressSummary(event)]
				.filter(Boolean)
				.join("\n");
		case "run_cancelled":
			return [`[${teamName}] Task cancelled`, buildProgressSummary(event)]
				.filter(Boolean)
				.join("\n");
		case "run_interrupted":
			return [`[${teamName}] Task interrupted`, buildProgressSummary(event)]
				.filter(Boolean)
				.join("\n");
		case "team_task_updated":
			if (event.summary.tasks.byStatus.in_progress <= 0) {
				return undefined;
			}
			return [`[${teamName}] Task queue updated`, buildProgressSummary(event)]
				.filter(Boolean)
				.join("\n");
		default:
			return undefined;
	}
}

export function findBindingForSessionId<TState extends ConnectorThreadState>(
	bindings: Record<string, ConnectorThreadBinding<TState>>,
	sessionId: string,
): { threadId: string; binding: ConnectorThreadBinding<TState> } | undefined {
	const trimmedSessionId = sessionId.trim();
	if (!trimmedSessionId) {
		return undefined;
	}
	for (const [threadId, binding] of Object.entries(bindings)) {
		if (
			binding.sessionId?.trim() === trimmedSessionId ||
			binding.state?.sessionId?.trim() === trimmedSessionId
		) {
			return { threadId, binding };
		}
	}
	return undefined;
}

export function createTaskUpdateFingerprint(
	event: TeamProgressProjectionEvent,
): string {
	return JSON.stringify({
		eventType: event.lastEvent.eventType,
		runId: event.lastEvent.runId ?? "",
		taskId: event.lastEvent.taskId ?? "",
		message: event.lastEvent.message ?? "",
		updatedAt: event.summary.updatedAt,
	});
}

export function startConnectorTaskUpdateRelay<
	TState extends ConnectorThreadState,
>(input: {
	client: HubSessionClient;
	clientId: string;
	bot: Chat;
	logger: CliLoggerAdapter;
	bindingsPath: string;
	transport: string;
	postToThread?: (input: {
		thread: Thread<TState>;
		binding: ConnectorThreadBinding<TState>;
		threadId: string;
		body: string;
	}) => Promise<void>;
}): () => void {
	const lastSentBySession = new Map<string, string>();

	const handleProjection = async (
		event: TeamProgressProjectionEvent,
	): Promise<void> => {
		const body = formatConnectorTaskUpdate(event);
		if (!body) {
			return;
		}
		const fingerprint = createTaskUpdateFingerprint(event);
		if (lastSentBySession.get(event.sessionId) === fingerprint) {
			return;
		}
		const match = findBindingForSessionId(
			readBindings<TState>(input.bindingsPath),
			event.sessionId,
		);
		if (!match?.binding.serializedThread) {
			return;
		}
		lastSentBySession.set(event.sessionId, fingerprint);
		try {
			const thread = JSON.parse(
				match.binding.serializedThread,
				input.bot.reviver(),
			) as Thread<TState>;
			if (input.postToThread) {
				await input.postToThread({
					thread,
					binding: match.binding,
					threadId: match.threadId,
					body,
				});
			} else {
				await thread.post(body);
			}
			input.logger.core.log("Connector task update sent", {
				transport: input.transport,
				threadId: match.threadId,
				sessionId: event.sessionId,
				eventType: event.lastEvent.eventType,
				runId: event.lastEvent.runId,
				taskId: event.lastEvent.taskId,
			});
		} catch (error) {
			input.logger.core.log("Connector task update delivery failed", {
				severity: "warn",
				transport: input.transport,
				threadId: match.threadId,
				sessionId: event.sessionId,
				eventType: event.lastEvent.eventType,
				error,
			});
		}
	};

	return input.client.streamTeamProgress(
		{ clientId: `${input.clientId}-task-updates` },
		{
			onProjection: (event) => {
				void handleProjection(event);
			},
			onError: (error) => {
				input.logger.core.log("Connector task update stream failed", {
					severity: "warn",
					transport: input.transport,
					error,
				});
			},
		},
	);
}
