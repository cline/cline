"use client";

import { useSyncExternalStore } from "react";

// The sidebar receives an execution event before the user drills into its
// schedule, so the unread state must survive that navigation handoff.
const unreadScheduleIds = new Set<string>();
const listeners = new Set<() => void>();

function emitChange() {
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function scheduleIdFromPayload(payload: unknown): string {
	if (!payload || typeof payload !== "object") return "";
	const scheduleId = (payload as { scheduleId?: unknown }).scheduleId;
	return typeof scheduleId === "string" ? scheduleId.trim() : "";
}

/** Records a completed or failed run until that schedule's Runs tab is opened. */
export function recordScheduleRunNotification(payload: unknown): void {
	const scheduleId = scheduleIdFromPayload(payload);
	if (!scheduleId || unreadScheduleIds.has(scheduleId)) return;
	unreadScheduleIds.add(scheduleId);
	emitChange();
}

export function markScheduleRunsRead(scheduleId: string | undefined): void {
	const normalized = scheduleId?.trim();
	if (!normalized || !unreadScheduleIds.delete(normalized)) return;
	emitChange();
}

export function useHasUnreadScheduleRun(
	scheduleId: string | undefined,
): boolean {
	const id = scheduleId?.trim();
	return useSyncExternalStore(
		subscribe,
		() => Boolean(id && unreadScheduleIds.has(id)),
		() => false,
	);
}

export function resetScheduleRunNotificationsForTesting(): void {
	if (unreadScheduleIds.size === 0) return;
	unreadScheduleIds.clear();
	emitChange();
}
