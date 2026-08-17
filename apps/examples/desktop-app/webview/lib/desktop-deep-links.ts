"use client";

import { desktopClient, isTauriAvailable } from "@/lib/desktop-client";

export const DESKTOP_DEEP_LINK_PENDING_EVENT = "desktop-deep-link-pending";

export type DesktopDeepLinkAction =
	| { type: "auth"; url: string; provider?: string }
	| { type: "open-project"; path: string; prompt?: string }
	| { type: "new-session"; path?: string; prompt?: string }
	| { type: "open-session"; sessionId: string; prompt?: string };

function routeName(url: URL): string {
	const path = url.pathname.replace(/^\/+/, "");
	return (
		url.hostname ? [url.hostname, path].filter(Boolean).join("/") : path
	).toLowerCase();
}

export function parseDesktopDeepLink(
	rawUrl: string,
): DesktopDeepLinkAction | null {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		return null;
	}
	if (url.protocol !== "cline:") return null;

	const route = routeName(url);
	const prompt = url.searchParams.get("prompt")?.trim() || undefined;
	const path =
		url.searchParams.get("path")?.trim() ||
		url.searchParams.get("project")?.trim() ||
		undefined;
	if (route === "auth" || route.startsWith("auth/")) {
		return {
			type: "auth",
			url: rawUrl,
			provider: url.searchParams.get("provider")?.trim() || undefined,
		};
	}
	if (route === "open-project" && path) {
		return { type: "open-project", path, prompt };
	}
	if (route === "new-session" || route === "task") {
		return { type: "new-session", path, prompt };
	}
	if (route === "open-session" || route === "session") {
		const sessionId =
			url.searchParams.get("id")?.trim() ||
			url.searchParams.get("sessionId")?.trim();
		return sessionId ? { type: "open-session", sessionId, prompt } : null;
	}
	return null;
}

export function subscribeToDesktopDeepLinks(
	onAction: (action: DesktopDeepLinkAction) => void | Promise<void>,
): () => void {
	if (!isTauriAvailable()) return () => {};
	let disposed = false;
	let unlisten: (() => void) | undefined;
	let draining = false;
	let drainAgain = false;

	const drain = async () => {
		if (disposed) return;
		if (draining) {
			drainAgain = true;
			return;
		}
		draining = true;
		try {
			do {
				drainAgain = false;
				const urls = await desktopClient.invoke<unknown>(
					"drain_desktop_deep_links",
				);
				if (!Array.isArray(urls)) continue;
				for (const rawUrl of urls) {
					if (typeof rawUrl !== "string") continue;
					const action = parseDesktopDeepLink(rawUrl);
					if (action) await onAction(action);
				}
			} while (drainAgain && !disposed);
		} finally {
			draining = false;
		}
	};

	void import("@tauri-apps/api/event").then(async ({ listen }) => {
		const stop = await listen<void>(
			DESKTOP_DEEP_LINK_PENDING_EVENT,
			() => void drain(),
		);
		if (disposed) return stop();
		unlisten = stop;
		await drain();
	});
	return () => {
		disposed = true;
		unlisten?.();
	};
}
