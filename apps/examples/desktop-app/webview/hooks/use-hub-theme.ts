"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_HUB_THEME, type HubTheme } from "@/lib/theme";

const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	if (!observer) {
		observer = new MutationObserver(() => {
			for (const notify of listeners) notify();
		});
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["class"],
		});
	}
	return () => {
		listeners.delete(listener);
		if (listeners.size === 0) {
			observer?.disconnect();
			observer = null;
		}
	};
}

function getSnapshot(): HubTheme {
	return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function getServerSnapshot(): HubTheme {
	return DEFAULT_HUB_THEME;
}

/** Follow the applied app theme, sharing one observer across all consumers. */
export function useHubTheme(): HubTheme {
	return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
