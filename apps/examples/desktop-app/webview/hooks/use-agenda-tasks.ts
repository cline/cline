"use client";

import type {
	AgendaAutomationPolicy,
	AgendaTaskListInput,
	AgendaTaskRecord,
	AgendaTaskStatus,
	HubTaskCreateInput,
} from "@cline/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { desktopClient } from "@/lib/desktop-client";

const TASK_EVENTS = [
	"task.created",
	"task.updated",
	"task.deleted",
	"task.run.started",
	"task.run.completed",
	"task.run.failed",
	"task.automation.updated",
] as const;

const STATUS_ORDER: Record<AgendaTaskStatus, number> = {
	in_progress: 0,
	pending_approval: 1,
	approved: 2,
	failed: 3,
	completed: 4,
	expired: 5,
	cancelled: 6,
};

export function sortAgendaTasks(tasks: AgendaTaskRecord[]): AgendaTaskRecord[] {
	return [...tasks].sort((left, right) => {
		const statusDifference =
			STATUS_ORDER[left.status] - STATUS_ORDER[right.status];
		if (statusDifference !== 0) return statusDifference;
		const priorityDifference = left.priority - right.priority;
		if (priorityDifference !== 0) return priorityDifference;
		const availabilityDifference =
			Date.parse(left.availableAt) - Date.parse(right.availableAt);
		if (
			Number.isFinite(availabilityDifference) &&
			availabilityDifference !== 0
		) {
			return availabilityDifference;
		}
		return Date.parse(left.createdAt) - Date.parse(right.createdAt);
	});
}

export function isAgendaTaskExpired(
	task: AgendaTaskRecord,
	now = Date.now(),
): boolean {
	const expiresAt = Date.parse(task.expiresAt);
	return (
		task.status === "expired" ||
		(Number.isFinite(expiresAt) && expiresAt <= now)
	);
}

export type UseAgendaTasksResult = {
	tasks: AgendaTaskRecord[];
	isLoading: boolean;
	error: string | null;
	pendingTaskIds: ReadonlySet<string>;
	refresh: () => Promise<void>;
	createTask: (input: HubTaskCreateInput) => Promise<AgendaTaskRecord>;
	approveTask: (task: AgendaTaskRecord) => Promise<AgendaTaskRecord>;
	cancelTask: (task: AgendaTaskRecord) => Promise<AgendaTaskRecord>;
	runTask: (task: AgendaTaskRecord) => Promise<AgendaTaskRecord>;
};

export type UseAgendaAutomationResult = {
	policy: AgendaAutomationPolicy | null;
	isLoading: boolean;
	isUpdating: boolean;
	error: string | null;
	setAutomatic: (automatic: boolean) => Promise<AgendaAutomationPolicy>;
};

const DEFAULT_AUTOMATION_POLICY: Omit<AgendaAutomationPolicy, "updatedAt"> = {
	scopeKey: "global",
	mode: "manual",
	applyToAgentCreated: true,
	maxConcurrentRuns: 1,
	maxChainDepth: 3,
	maxStartsPerHour: 20,
};

function editableAutomationPolicy(
	policy: AgendaAutomationPolicy,
): Omit<AgendaAutomationPolicy, "updatedAt"> {
	return {
		scopeKey: policy.scopeKey,
		mode: policy.mode,
		applyToAgentCreated: policy.applyToAgentCreated,
		maxConcurrentRuns: policy.maxConcurrentRuns,
		maxChainDepth: policy.maxChainDepth,
		maxStartsPerHour: policy.maxStartsPerHour,
		enabledBy: policy.enabledBy,
		enabledAt: policy.enabledAt,
	};
}

export function useAgendaAutomation(enabled = true): UseAgendaAutomationResult {
	const [policy, setPolicy] = useState<AgendaAutomationPolicy | null>(null);
	const [isLoading, setIsLoading] = useState(enabled);
	const [isUpdating, setIsUpdating] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		if (!enabled) {
			setIsLoading(false);
			return;
		}
		setIsLoading(true);
		try {
			setPolicy(await desktopClient.getAgendaAutomationPolicy());
			setError(null);
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Unable to load Agenda automation.",
			);
		} finally {
			setIsLoading(false);
		}
	}, [enabled]);

	useEffect(() => {
		void refresh();
		if (!enabled) return;
		const unsubscribeEvent = desktopClient.subscribe(
			"task.automation.updated",
			() => void refresh(),
		);
		const unsubscribeTransport = desktopClient.subscribeTransportState(
			(state) => {
				if (state === "connected") void refresh();
			},
		);
		return () => {
			unsubscribeEvent();
			unsubscribeTransport();
		};
	}, [enabled, refresh]);

	const setAutomatic = useCallback(
		async (automatic: boolean) => {
			setIsUpdating(true);
			setError(null);
			try {
				const current = policy
					? editableAutomationPolicy(policy)
					: DEFAULT_AUTOMATION_POLICY;
				const next = await desktopClient.setAgendaAutomationPolicy({
					policy: {
						...current,
						mode: automatic ? "auto_start" : "manual",
					},
				});
				setPolicy(next);
				return next;
			} catch (cause) {
				setError(
					cause instanceof Error
						? cause.message
						: "Unable to update Agenda automation.",
				);
				throw cause;
			} finally {
				setIsUpdating(false);
			}
		},
		[policy],
	);

	return { policy, isLoading, isUpdating, error, setAutomatic };
}

/**
 * Live task queue state backed by Hub commands. Task events are invalidation
 * signals rather than an event-sourced cache, so every mutation/event re-lists
 * the current projection and reconnects cannot leave stale Agenda state.
 */
export function useAgendaTasks(
	filters: AgendaTaskListInput = {},
	enabled = true,
): UseAgendaTasksResult {
	const filtersKey = JSON.stringify(filters);
	const parsedFilters = useMemo(
		() => JSON.parse(filtersKey) as AgendaTaskListInput,
		[filtersKey],
	);
	const [tasks, setTasks] = useState<AgendaTaskRecord[]>([]);
	const [isLoading, setIsLoading] = useState(enabled);
	const [error, setError] = useState<string | null>(null);
	const [pendingTaskIds, setPendingTaskIds] = useState<Set<string>>(
		() => new Set(),
	);
	const requestSequence = useRef(0);

	const refresh = useCallback(async () => {
		if (!enabled) {
			setTasks([]);
			setIsLoading(false);
			setError(null);
			return;
		}
		const requestId = ++requestSequence.current;
		setIsLoading(true);
		try {
			const nextTasks = await desktopClient.listAgendaTasks(parsedFilters);
			if (requestId !== requestSequence.current) return;
			setTasks(sortAgendaTasks(nextTasks));
			setError(null);
		} catch (cause) {
			if (requestId !== requestSequence.current) return;
			setError(
				cause instanceof Error ? cause.message : "Unable to load the Agenda.",
			);
		} finally {
			if (requestId === requestSequence.current) setIsLoading(false);
		}
	}, [enabled, parsedFilters]);

	useEffect(() => {
		void refresh();
		if (!enabled) return;

		const invalidate = () => void refresh();
		const unsubscribeEvents = TASK_EVENTS.map((eventName) =>
			desktopClient.subscribe(eventName, invalidate),
		);
		const unsubscribeTransport = desktopClient.subscribeTransportState(
			(state) => {
				if (state === "connected") void refresh();
			},
		);
		return () => {
			requestSequence.current += 1;
			for (const unsubscribe of unsubscribeEvents) unsubscribe();
			unsubscribeTransport();
		};
	}, [enabled, refresh]);

	const mutateTask = useCallback(
		async (
			task: AgendaTaskRecord,
			operation: (task: AgendaTaskRecord) => Promise<AgendaTaskRecord>,
		) => {
			setPendingTaskIds((current) => new Set(current).add(task.taskId));
			setError(null);
			try {
				const next = await operation(task);
				setTasks((current) =>
					sortAgendaTasks(
						current.map((item) => (item.taskId === next.taskId ? next : item)),
					),
				);
				void refresh();
				return next;
			} catch (cause) {
				const message =
					cause instanceof Error ? cause.message : "Unable to update the task.";
				setError(message);
				throw cause;
			} finally {
				setPendingTaskIds((current) => {
					const next = new Set(current);
					next.delete(task.taskId);
					return next;
				});
			}
		},
		[refresh],
	);
	const createTask = useCallback(
		async (input: HubTaskCreateInput) => {
			setError(null);
			try {
				const created = await desktopClient.createAgendaTask(input);
				setTasks((current) => sortAgendaTasks([created, ...current]));
				void refresh();
				return created;
			} catch (cause) {
				const message =
					cause instanceof Error ? cause.message : "Unable to create the task.";
				setError(message);
				throw cause;
			}
		},
		[refresh],
	);

	const approveTask = useCallback(
		(task: AgendaTaskRecord) =>
			mutateTask(task, (current) =>
				desktopClient.approveAgendaTask({
					taskId: current.taskId,
					expectedRevision: current.revision,
				}),
			),
		[mutateTask],
	);
	const cancelTask = useCallback(
		(task: AgendaTaskRecord) =>
			mutateTask(task, (current) =>
				desktopClient.cancelAgendaTask({
					taskId: current.taskId,
					expectedRevision: current.revision,
				}),
			),
		[mutateTask],
	);
	const runTask = useCallback(
		(task: AgendaTaskRecord) =>
			mutateTask(task, async (current) => {
				const result = await desktopClient.runAgendaTask({
					taskId: current.taskId,
					expectedRevision: current.revision,
				});
				return result.run?.sessionId && !result.task.lastSessionId
					? { ...result.task, lastSessionId: result.run.sessionId }
					: result.task;
			}),
		[mutateTask],
	);

	return {
		tasks,
		isLoading,
		error,
		pendingTaskIds,
		refresh,
		createTask,
		approveTask,
		cancelTask,
		runTask,
	};
}
