import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { AppState, Platform } from "react-native";
import type { AttentionEvent } from "@/connection/cloud-launches";
import type { ConnectionDescriptor } from "@/connection/endpoints";
import type { AttentionKind } from "./attention-events";

const PREFERENCE_KEY = "cline.mobile.task-alerts.v1";
const CHANNEL = "task-attention";
let preferenceGeneration = 0;
let preferenceWrite: Promise<void> = Promise.resolve();
const CONTENT: Record<AttentionKind, { title: string; body: string }> = {
	approval: {
		title: "Cline needs your approval",
		body: "Open the task to review the requested action.",
	},
	question: {
		title: "Cline has a question",
		body: "Open the task to answer and continue.",
	},
	error: {
		title: "A Cline task needs attention",
		body: "Open the task to review what happened.",
	},
	completed: {
		title: "Cline finished a task",
		body: "Open the conversation to review the result.",
	},
};

export async function taskAlertsEnabled(): Promise<boolean> {
	return (await SecureStore.getItemAsync(PREFERENCE_KEY)) === "true";
}

export async function setTaskAlertsEnabled(enabled: boolean): Promise<boolean> {
	const generation = ++preferenceGeneration;
	if (enabled) {
		if (Platform.OS === "android")
			await Notifications.setNotificationChannelAsync(CHANNEL, {
				name: "Tasks needing attention",
				importance: Notifications.AndroidImportance.HIGH,
			});
		const permission = await Notifications.requestPermissionsAsync({
			ios: { allowAlert: true, allowSound: true, allowBadge: false },
		});
		if (
			!permission.granted &&
			permission.ios?.status !==
				Notifications.IosAuthorizationStatus.PROVISIONAL
		)
			enabled = false;
	}
	if (generation !== preferenceGeneration) return false;
	const write = preferenceWrite.then(async () => {
		if (generation === preferenceGeneration)
			await SecureStore.setItemAsync(PREFERENCE_KEY, String(enabled));
	});
	preferenceWrite = write.catch(() => {});
	await write;
	if (generation !== preferenceGeneration) return false;
	if (!enabled)
		await Promise.all([
			Notifications.dismissAllNotificationsAsync(),
			Notifications.cancelAllScheduledNotificationsAsync(),
		]);
	return enabled;
}

/** Only accept our stored, exact task pointer, never a notification-provided URL. */
export function attentionTarget(
	data: unknown,
	get: (key: string) => ConnectionDescriptor | undefined,
): ConnectionDescriptor | undefined {
	if (!data || typeof data !== "object") return;
	const value = data as Record<string, unknown>;
	if (
		value.type !== "cline-task-attention" ||
		typeof value.endpointKey !== "string" ||
		typeof value.sessionId !== "string" ||
		!value.sessionId ||
		typeof value.remoteSessionId !== "string"
	)
		return;
	const descriptor = get(value.endpointKey);
	if (
		descriptor?.mode !== "cloud" ||
		descriptor.remoteSessionId !== value.remoteSessionId ||
		descriptor.hubSessionId !== value.sessionId
	)
		return;
	return descriptor;
}

/** Client-received events only. Suspended-app delivery requires server push. */
export function watchTaskAlerts(source: {
	subscribeAttention(listener: (event: AttentionEvent) => void): () => void;
	isAttentionFocused?(key: string): boolean;
}) {
	let generation = 0;
	let disposed = false;
	const seen = new Set<string>();
	const isFocused = (event: Extract<AttentionEvent, { type: "attention" }>) =>
		(source.isAttentionFocused?.(event.endpointKey) ?? event.focused) &&
		AppState.currentState === "active";
	Notifications.setNotificationHandler({
		handleNotification: async () => ({
			shouldShowBanner: true,
			shouldShowList: true,
			shouldPlaySound: true,
			shouldSetBadge: false,
		}),
	});
	const unsubscribe = source.subscribeAttention((event) => {
		if (event.type === "clear") {
			generation += 1;
			seen.clear();
			void Notifications.dismissAllNotificationsAsync().catch(() => {});
			void Notifications.cancelAllScheduledNotificationsAsync().catch(() => {});
			Notifications.clearLastNotificationResponse();
			return;
		}
		if (isFocused(event) || seen.has(event.id)) return;
		seen.add(event.id);
		if (seen.size > 256) seen.delete(seen.values().next().value!);
		const current = generation;
		const preference = preferenceGeneration;
		let scheduled = false;
		const retired = () =>
			disposed || current !== generation || preference !== preferenceGeneration;
		void (async () => {
			if (!(await taskAlertsEnabled()) || retired()) return;
			const permission = await Notifications.getPermissionsAsync();
			if (
				(!permission.granted &&
					permission.ios?.status !==
						Notifications.IosAuthorizationStatus.PROVISIONAL) ||
				retired() ||
				isFocused(event)
			)
				return;
			if (!(await taskAlertsEnabled()) || retired() || isFocused(event)) return;
			const id = await Notifications.scheduleNotificationAsync({
				content: {
					...CONTENT[event.kind],
					sound: event.kind === "completed" ? false : "default",
					data: {
						type: "cline-task-attention",
						endpointKey: event.endpointKey,
						remoteSessionId: event.remoteSessionId,
						sessionId: event.sessionId,
					},
				},
				trigger: Platform.OS === "android" ? { channelId: CHANNEL } : null,
			});
			if (retired() || isFocused(event)) {
				await Promise.all([
					Notifications.dismissNotificationAsync(id),
					Notifications.cancelScheduledNotificationAsync(id),
				]);
			} else scheduled = true;
		})()
			.catch(() => {
				/* Notification failures never block the conversation. */
			})
			.finally(() => {
				if (!scheduled && current === generation) seen.delete(event.id);
			});
	});
	return () => {
		disposed = true;
		generation += 1;
		unsubscribe();
	};
}
