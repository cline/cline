import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { AppState, Platform } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AttentionEvent } from "../connection/cloud-launches";
import {
	type ConnectionDescriptor,
	descriptorKey,
} from "../connection/endpoints";
import {
	attentionTarget,
	setTaskAlertsEnabled,
	watchTaskAlerts,
} from "./attention-notifications";

const permission = (granted: boolean, provisional = false) =>
	({
		granted,
		ios: {
			status: provisional
				? Notifications.IosAuthorizationStatus.PROVISIONAL
				: Notifications.IosAuthorizationStatus.DENIED,
		},
	}) as Notifications.NotificationPermissionsStatus;
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
async function settle() {
	for (let i = 0; i < 30; i++) await Promise.resolve();
}
const disposers: (() => void)[] = [];
const event: Extract<AttentionEvent, { type: "attention" }> = {
	type: "attention",
	id: "task:approval:1",
	kind: "approval",
	endpointKey: "stored-key",
	remoteSessionId: "outer",
	sessionId: "inner",
	focused: false,
};
function source() {
	let focused = false;
	const listeners = new Set<(event: AttentionEvent) => void>();
	const source = {
		subscribeAttention(listener: (event: AttentionEvent) => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		isAttentionFocused: () => focused,
	};
	const stop = watchTaskAlerts(source);
	disposers.push(stop);
	return {
		emit: (value: AttentionEvent = event) => {
			for (const listener of listeners) listener(value);
		},
		focus: () => {
			focused = true;
		},
		stop,
	};
}
beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(SecureStore.getItemAsync).mockResolvedValue("true");
	vi.mocked(SecureStore.setItemAsync).mockResolvedValue();
	vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue(
		permission(true),
	);
	vi.mocked(Notifications.requestPermissionsAsync).mockResolvedValue(
		permission(true),
	);
	vi.mocked(Notifications.scheduleNotificationAsync).mockResolvedValue(
		"notification-1",
	);
	AppState.currentState = "active";
});
afterEach(() => {
	for (const dispose of disposers.splice(0)) dispose();
	AppState.currentState = "active";
});

describe("task notification delivery", () => {
	it("deduplicates pending and delivered events and uses private generic copy with exact stored pointers", async () => {
		const alerts = source();
		alerts.emit();
		alerts.emit();
		await settle();
		alerts.emit();
		await settle();
		expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledOnce();
		const input = vi.mocked(Notifications.scheduleNotificationAsync).mock
			.calls[0]?.[0];
		expect(input?.content).toMatchObject({
			title: "Cline needs your approval",
			body: "Open the task to review the requested action.",
			data: {
				type: "cline-task-attention",
				endpointKey: "stored-key",
				remoteSessionId: "outer",
				sessionId: "inner",
			},
		});
		expect(Object.keys(input?.content?.data ?? {}).sort()).toEqual([
			"endpointKey",
			"remoteSessionId",
			"sessionId",
			"type",
		]);
	});

	it("suppresses the active focused chat but delivers an event received while backgrounded", async () => {
		const alerts = source();
		alerts.focus();
		alerts.emit();
		await settle();
		expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
		AppState.currentState = "background";
		alerts.emit();
		await settle();
		expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledOnce();
	});

	it("does not request permissions automatically and allows retry after permission is granted", async () => {
		vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue(
			permission(false),
		);
		const alerts = source();
		alerts.emit();
		await settle();
		expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
		expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
		vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue(
			permission(true),
		);
		alerts.emit();
		await settle();
		expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledOnce();
	});

	it("does not schedule when the preference is disabled or when focus changes during permission lookup", async () => {
		vi.mocked(SecureStore.getItemAsync).mockResolvedValueOnce("false");
		const alerts = source();
		alerts.emit();
		await settle();
		expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
		const check = deferred<Notifications.NotificationPermissionsStatus>();
		vi.mocked(Notifications.getPermissionsAsync).mockReturnValueOnce(
			check.promise,
		);
		alerts.emit();
		await settle();
		alerts.focus();
		check.resolve(permission(true));
		await settle();
		expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
	});

	it("retires pending scheduling when the user disables alerts", async () => {
		const check = deferred<Notifications.NotificationPermissionsStatus>();
		vi.mocked(Notifications.getPermissionsAsync).mockReturnValueOnce(
			check.promise,
		);
		const alerts = source();
		alerts.emit();
		await settle();
		await setTaskAlertsEnabled(false);
		check.resolve(permission(true));
		await settle();
		expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
		expect(
			Notifications.cancelAllScheduledNotificationsAsync,
		).toHaveBeenCalled();
	});

	it.each([
		"sign-out",
		"unmount",
	])("dismisses and cancels a late schedule after %s", async (action) => {
		const schedule = deferred<string>();
		vi.mocked(Notifications.scheduleNotificationAsync).mockReturnValueOnce(
			schedule.promise,
		);
		const alerts = source();
		alerts.emit();
		await settle();
		if (action === "sign-out") alerts.emit({ type: "clear" });
		else alerts.stop();
		schedule.resolve("late-id");
		await settle();
		expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith(
			"late-id",
		);
		expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(
			"late-id",
		);
		if (action === "sign-out")
			expect(Notifications.clearLastNotificationResponse).toHaveBeenCalled();
	});

	it("does not let an earlier permission prompt enable alerts after a newer opt-out", async () => {
		const request = deferred<Notifications.NotificationPermissionsStatus>();
		vi.mocked(Notifications.requestPermissionsAsync).mockReturnValueOnce(
			request.promise,
		);
		const enable = setTaskAlertsEnabled(true);
		await settle();
		await setTaskAlertsEnabled(false);
		request.resolve(permission(true));
		expect(await enable).toBe(false);
		expect(
			vi.mocked(SecureStore.setItemAsync).mock.calls.map((call) => call[1]),
		).toEqual(["false"]);
	});

	it("persists denied permission as disabled and accepts iOS provisional permission", async () => {
		vi.mocked(Notifications.requestPermissionsAsync).mockResolvedValueOnce(
			permission(false),
		);
		expect(await setTaskAlertsEnabled(true)).toBe(false);
		expect(SecureStore.setItemAsync).toHaveBeenLastCalledWith(
			expect.any(String),
			"false",
		);
		vi.mocked(Notifications.requestPermissionsAsync).mockResolvedValueOnce(
			permission(false, true),
		);
		expect(await setTaskAlertsEnabled(true)).toBe(true);
		if (Platform.OS === "ios")
			expect(Notifications.setNotificationChannelAsync).not.toHaveBeenCalled();
	});
});

describe("notification route pointers", () => {
	const descriptor: ConnectionDescriptor = {
		mode: "cloud",
		url: "https://saved.invalid/task",
		remoteSessionId: "outer",
		hubSessionId: "inner",
	};
	const data = {
		type: "cline-task-attention",
		endpointKey: descriptorKey(descriptor),
		remoteSessionId: "outer",
		sessionId: "inner",
	};
	it("uses the stored exact descriptor and rejects missing, replaced, or local targets", () => {
		expect(attentionTarget(data, () => descriptor)).toBe(descriptor);
		for (const target of [
			undefined,
			{ ...descriptor, mode: "local" as const },
			{ ...descriptor, hubSessionId: "other" },
			{ ...descriptor, remoteSessionId: "other" },
		])
			expect(attentionTarget(data, () => target)).toBeUndefined();
		for (const unsafe of [
			null,
			{},
			{ ...data, type: "url", url: "https://attacker.invalid" },
			{ ...data, sessionId: "" },
			{ ...data, remoteSessionId: "other" },
			{ ...data, endpointKey: 3 },
		])
			expect(attentionTarget(unsafe, () => descriptor)).toBeUndefined();
	});
});
