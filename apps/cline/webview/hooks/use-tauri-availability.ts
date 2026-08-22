"use client";

import { useSyncExternalStore } from "react";
import { isTauriAvailable } from "@/lib/desktop-client";

function subscribeToTauriAvailability(): () => void {
	return () => {};
}

function getServerSnapshot(): boolean {
	return false;
}

/**
 * Reports whether the webview is running inside the native Tauri shell without
 * making the first browser render differ from the server-rendered HTML.
 * Tauri injects its bridge before page scripts run, so availability is stable
 * for the lifetime of the mounted application and does not need a live event
 * subscription.
 */
export function useTauriAvailability(): boolean {
	return useSyncExternalStore(
		subscribeToTauriAvailability,
		isTauriAvailable,
		getServerSnapshot,
	);
}
