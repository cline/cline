"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useIsMounted } from "@/hooks/use-is-mounted";
import { recordScheduleRunNotification } from "@/hooks/use-schedule-run-notifications";
import { toast } from "@/hooks/use-toast";
import { desktopClient } from "@/lib/desktop-client";
import type {
	Schedule,
	ScheduleExecution,
	ScheduleOverviewResponse,
} from "./schedule-types";

const SCHEDULE_OVERVIEW_POLL_INTERVAL_MS = 15_000;

// Preserve the last snapshot for navigation, but always revalidate on mount.
let scheduleOverviewCache: ScheduleOverviewResponse | null = null;

async function fetchScheduleOverview(): Promise<ScheduleOverviewResponse> {
	const response = await desktopClient.invoke<ScheduleOverviewResponse>(
		"list_routine_schedules",
	);
	return {
		schedules: response.schedules ?? [],
		activeExecutions: (response.activeExecutions ?? []).map((execution) => ({
			...execution,
			status: execution.status ?? "running",
			triggeredAt: execution.triggeredAt ?? execution.startedAt,
		})),
		lastExecutions: response.lastExecutions ?? [],
	};
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function useSchedules() {
	const [overview, setOverview] = useState<ScheduleOverviewResponse>(
		() =>
			scheduleOverviewCache ?? {
				schedules: [],
				activeExecutions: [],
				lastExecutions: [],
			},
	);
	const [isLoading, setIsLoading] = useState(() => !scheduleOverviewCache);
	// Loading the overview and acting on a schedule fail independently: a
	// background refresh must not erase, or masquerade as, an action's error.
	const [loadError, setLoadError] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const clearActionError = useCallback(() => setActionError(null), []);
	const overviewRequestSequence = useRef(0);
	const overviewRefreshPending = useRef(false);
	// Sets rather than single ids: several rows can have in-flight actions at
	// once, and one action finishing must not clear another row's busy state.
	const [busyScheduleIds, setBusyScheduleIds] = useState<ReadonlySet<string>>(
		new Set(),
	);
	const [triggeringScheduleIds, setTriggeringScheduleIds] = useState<
		ReadonlySet<string>
	>(new Set());
	// Ref mirrors busyScheduleIds so a second click on the same row is
	// rejected synchronously — two rapid clicks can both fire before React
	// re-renders the disabled state, and state alone can't distinguish them.
	const busyScheduleIdsRef = useRef<Set<string>>(new Set());
	const mountedRef = useIsMounted();
	const beginScheduleAction = (scheduleId: string): boolean => {
		if (busyScheduleIdsRef.current.has(scheduleId)) {
			return false;
		}
		busyScheduleIdsRef.current.add(scheduleId);
		setBusyScheduleIds(new Set(busyScheduleIdsRef.current));
		return true;
	};
	const endScheduleAction = (scheduleId: string) => {
		busyScheduleIdsRef.current.delete(scheduleId);
		setBusyScheduleIds(new Set(busyScheduleIdsRef.current));
	};
	const setScheduleTriggering = (scheduleId: string, triggering: boolean) => {
		setTriggeringScheduleIds((previous) => {
			const next = new Set(previous);
			if (triggering) {
				next.add(scheduleId);
			} else {
				next.delete(scheduleId);
			}
			return next;
		});
	};
	const [schedulePendingDelete, setSchedulePendingDelete] =
		useState<Schedule | null>(null);
	const refreshSchedules = useCallback(
		async (options?: { showLoading?: boolean }) => {
			if (options?.showLoading !== false) {
				setIsLoading(true);
			}
			const requestId = ++overviewRequestSequence.current;
			overviewRefreshPending.current = true;
			try {
				const response = await fetchScheduleOverview();
				if (
					!mountedRef.current ||
					requestId !== overviewRequestSequence.current
				)
					return response;
				setOverview(response);
				scheduleOverviewCache = response;
				// Only a successful load retires the previous failure, so an
				// unreachable hub does not blink between error and empty states.
				setLoadError(null);
				return response;
			} catch (error) {
				if (
					!mountedRef.current ||
					requestId !== overviewRequestSequence.current
				)
					return;
				setLoadError(errorText(error));
			} finally {
				if (
					mountedRef.current &&
					requestId === overviewRequestSequence.current
				) {
					overviewRefreshPending.current = false;
					setIsLoading(false);
				}
			}
		},
		[mountedRef],
	);

	useEffect(() => {
		const refresh = () => {
			void refreshSchedules({ showLoading: false });
		};
		const refreshVisible = () => {
			// Background refreshes must not supersede a slow request on every
			// poll, otherwise neither its response nor its error can be shown.
			if (
				document.visibilityState === "visible" &&
				!overviewRefreshPending.current
			) {
				refresh();
			}
		};
		const timeoutId = window.setTimeout(() => {
			refresh();
		}, 0);
		// Completion events deliver errors promptly, including failures before
		// session creation. Polling also picks up queued/running transitions
		// and changes missed during a transport disconnect.
		const refreshAfterExecution = (payload: unknown) => {
			recordScheduleRunNotification(payload);
			refresh();
		};
		const unsubscribers = [
			"schedule.execution_completed",
			"schedule.execution_failed",
		].map((event) => desktopClient.subscribe(event, refreshAfterExecution));
		const intervalId = window.setInterval(
			refreshVisible,
			SCHEDULE_OVERVIEW_POLL_INTERVAL_MS,
		);
		window.addEventListener("focus", refreshVisible);
		document.addEventListener("visibilitychange", refreshVisible);
		return () => {
			overviewRequestSequence.current += 1;
			window.clearTimeout(timeoutId);
			window.clearInterval(intervalId);
			for (const unsubscribe of unsubscribers) unsubscribe();
			window.removeEventListener("focus", refreshVisible);
			document.removeEventListener("visibilitychange", refreshVisible);
		};
	}, [refreshSchedules]);

	const setScheduleEnabled = async (
		schedule: Schedule,
		enabled: boolean,
	): Promise<boolean> => {
		if (!beginScheduleAction(schedule.scheduleId)) {
			return false;
		}
		setActionError(null);
		try {
			await desktopClient.invoke(
				enabled ? "resume_routine_schedule" : "pause_routine_schedule",
				{ schedule_id: schedule.scheduleId },
			);
			await refreshSchedules({ showLoading: false });
			return true;
		} catch (error) {
			setActionError(errorText(error));
			return false;
		} finally {
			endScheduleAction(schedule.scheduleId);
		}
	};

	/** Resolves once the run is queued; refreshing its status continues in the background. */
	const triggerSchedule = async (schedule: Schedule): Promise<boolean> => {
		if (!beginScheduleAction(schedule.scheduleId)) {
			return false;
		}
		setScheduleTriggering(schedule.scheduleId, true);
		setActionError(null);
		try {
			const reply = await desktopClient.invoke<{
				execution?: ScheduleExecution | null;
			}>("trigger_routine_schedule", {
				schedule_id: schedule.scheduleId,
			});
			// A reply without an execution means no run was enqueued (the
			// schedule may have been deleted or become invalid since the page
			// loaded) — say so instead of confirming a start.
			if (!reply?.execution) {
				toast({
					title: "Run not started",
					description: `"${schedule.name}" did not queue a run — the schedule may have been deleted or its settings may be invalid.`,
					variant: "destructive",
				});
				await refreshSchedules({ showLoading: false });
				return false;
			}
			toast({
				title: "Run started",
				description: `"${schedule.name}" was queued to run now.`,
			});
		} catch (error) {
			const message = errorText(error);
			setActionError(message);
			toast({
				title: "Failed to start run",
				description: message,
				variant: "destructive",
			});
			return false;
		} finally {
			// Release the schedule as soon as the run is queued.
			endScheduleAction(schedule.scheduleId);
			setScheduleTriggering(schedule.scheduleId, false);
		}
		void refreshSchedules({ showLoading: false });
		return true;
	};

	const deleteSchedule = async (scheduleId: string): Promise<boolean> => {
		if (!beginScheduleAction(scheduleId)) {
			return false;
		}
		setActionError(null);
		try {
			await desktopClient.invoke("delete_routine_schedule", {
				schedule_id: scheduleId,
			});
			setSchedulePendingDelete(null);
			await refreshSchedules({ showLoading: false });
			return true;
		} catch (error) {
			setActionError(errorText(error));
			return false;
		} finally {
			endScheduleAction(scheduleId);
		}
	};

	return {
		...overview,
		isLoading,
		loadError,
		actionError,
		clearActionError,
		busyScheduleIds,
		triggeringScheduleIds,
		schedulePendingDelete,
		setSchedulePendingDelete,
		refreshSchedules,
		setScheduleEnabled,
		triggerSchedule,
		deleteSchedule,
	};
}
