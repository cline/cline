"use client";

import { type AppZoomAction, isAppZoomAction } from "@/lib/app-font-size";
import { desktopClient, isTauriAvailable } from "@/lib/desktop-client";

export const DESKTOP_MENU_ACTION_PENDING_EVENT = "desktop-menu-action-pending";
const TRAY_STATUS_REFRESH_INTERVAL_MS = 5_000;

export type DesktopMenuAction = "new-session" | "open-settings" | AppZoomAction;

type ProcessContext = {
	runningSessionCount?: unknown;
	hub?: {
		status?: unknown;
	};
};

function isDesktopMenuAction(value: unknown): value is DesktopMenuAction {
	return (
		value === "new-session" ||
		value === "open-settings" ||
		isAppZoomAction(value)
	);
}

export function subscribeToDesktopMenuActions(
	onAction: (action: DesktopMenuAction) => void,
): () => void {
	if (!isTauriAvailable()) {
		return () => {};
	}

	let disposed = false;
	let unlisten: (() => void) | undefined;
	let draining = false;
	let drainRequested = false;

	const drainPendingActions = async () => {
		if (disposed) {
			return;
		}
		if (draining) {
			drainRequested = true;
			return;
		}

		draining = true;
		try {
			do {
				drainRequested = false;
				const pending = await desktopClient.invoke<unknown>(
					"drain_desktop_menu_actions",
				);
				if (!Array.isArray(pending)) {
					continue;
				}
				for (const action of pending) {
					if (isDesktopMenuAction(action)) {
						onAction(action);
					}
				}
			} while (drainRequested && !disposed);
		} catch {
			// The native queue retains actions when the drain command fails.
		} finally {
			draining = false;
			if (drainRequested && !disposed) {
				void drainPendingActions();
			}
		}
	};

	void import("@tauri-apps/api/event")
		.then(async ({ listen }) => {
			const stopListening = await listen<void>(
				DESKTOP_MENU_ACTION_PENDING_EVENT,
				() => void drainPendingActions(),
			);
			if (disposed) {
				stopListening();
				return;
			}
			unlisten = stopListening;
			// Actions selected before listener registration remain in the native
			// queue, so this initial drain closes the startup delivery gap.
			await drainPendingActions();
		})
		.catch(() => {
			// The browser-only development shell has no native event bridge.
		});

	return () => {
		disposed = true;
		unlisten?.();
	};
}

async function refreshDesktopTrayStatus(): Promise<void> {
	let context: ProcessContext;
	try {
		context = await desktopClient.invoke<ProcessContext>("get_process_context");
	} catch {
		// Preserve the last known status during transient sidecar reconnects.
		return;
	}

	let runningSessions = 0;
	if (
		typeof context.runningSessionCount === "number" &&
		Number.isFinite(context.runningSessionCount)
	) {
		runningSessions = Math.max(0, Math.floor(context.runningSessionCount));
	}

	try {
		await desktopClient.invoke("set_tray_status", {
			hubHealthy: context.hub?.status === "connected",
			runningSessions,
		});
	} catch {
		// Tray status is best-effort and unavailable in the browser-only shell.
	}
}

export function watchDesktopTrayStatus(): () => void {
	if (!isTauriAvailable()) {
		return () => {};
	}

	let stopped = false;
	let refreshing = false;
	const refresh = async () => {
		if (stopped || refreshing) {
			return;
		}
		refreshing = true;
		try {
			await refreshDesktopTrayStatus();
		} finally {
			refreshing = false;
		}
	};

	void refresh();
	const interval = window.setInterval(
		() => void refresh(),
		TRAY_STATUS_REFRESH_INTERVAL_MS,
	);

	return () => {
		stopped = true;
		window.clearInterval(interval);
	};
}
