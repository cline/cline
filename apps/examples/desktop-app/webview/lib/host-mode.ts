"use client";

import { useSyncExternalStore } from "react";
import { isTauriAvailable } from "@/lib/desktop-client";
import { getHostShell, type HostShellKind } from "@/lib/host-shell";

/**
 * Which shell is hosting the webview.
 *
 * - `desktop`: the Tauri app (`src-tauri`). Owns the window, tray, updater,
 *   PTY terminal, keybindings and look-and-feel.
 * - `vscode`: the VS Code extension (`apps/examples/vscode-desktop`). The
 *   editor already provides a terminal, file explorer, diff viewer, theme,
 *   font size and keybindings, so the UI defers to it for those.
 * - `web`: plain browser tab against a sidecar (`bun run dev:headless`).
 *
 * Components should branch on `useHostCapabilities()` rather than on the
 * mode itself, so adding another host is a matter of describing what it has.
 */
export type HostMode = "desktop" | HostShellKind | "web";

export type HostCapabilities = {
	mode: HostMode;
	/** The host can quit/relaunch the whole application. */
	canQuit: boolean;
	/** The host ships its own PTY-backed terminal panel. */
	hasIntegratedTerminal: boolean;
	/** The webview should offer its own file browser / changes pane. */
	hasFileBrowser: boolean;
	/** The host can show a two-column diff for a file outside the webview. */
	opensDiffsExternally: boolean;
	/** The host decides light/dark; the in-app toggle is hidden. */
	ownsTheme: boolean;
	/** The host decides the base font size; the in-app picker is hidden. */
	ownsFontSize: boolean;
	/** Shortcuts are configured in the host, not in Settings → Keybindings. */
	ownsKeybindings: boolean;
	/** The host has a Dock/taskbar icon the user can customise. */
	hasAppIcon: boolean;
	/** The host updates itself (and the bundled CLI). */
	hasAutoUpdate: boolean;
	/** The host has its own notion of "the current workspace folder". */
	ownsWorkspace: boolean;
	/** Tight horizontal space: prefer stacked layouts over side-by-side. */
	compactLayout: boolean;
};

let cachedMode: HostMode | null = null;

export function getHostMode(): HostMode {
	if (cachedMode) return cachedMode;
	if (typeof window === "undefined") return "web";
	const shell = getHostShell();
	cachedMode = shell ? shell.kind : isTauriAvailable() ? "desktop" : "web";
	// Lets globals.css adapt layout per host without a React render.
	document.documentElement.dataset.clineHost = cachedMode;
	return cachedMode;
}

/** Test helper: forget the detected mode so the next read re-probes `window`. */
export function resetHostModeForTesting(): void {
	cachedMode = null;
}

export function hostCapabilitiesFor(mode: HostMode): HostCapabilities {
	switch (mode) {
		case "vscode":
			return {
				mode,
				canQuit: false,
				hasIntegratedTerminal: false,
				hasFileBrowser: false,
				opensDiffsExternally: true,
				ownsTheme: true,
				ownsFontSize: true,
				ownsKeybindings: true,
				hasAppIcon: false,
				hasAutoUpdate: false,
				ownsWorkspace: true,
				compactLayout: true,
			};
		case "desktop":
			return {
				mode,
				canQuit: true,
				hasIntegratedTerminal: true,
				hasFileBrowser: true,
				opensDiffsExternally: false,
				ownsTheme: false,
				ownsFontSize: false,
				ownsKeybindings: false,
				hasAppIcon: true,
				hasAutoUpdate: true,
				ownsWorkspace: false,
				compactLayout: false,
			};
		default:
			return {
				mode,
				canQuit: false,
				hasIntegratedTerminal: false,
				hasFileBrowser: true,
				opensDiffsExternally: false,
				ownsTheme: false,
				ownsFontSize: false,
				ownsKeybindings: false,
				hasAppIcon: false,
				hasAutoUpdate: false,
				ownsWorkspace: false,
				compactLayout: false,
			};
	}
}

const capabilityCache = new Map<HostMode, HostCapabilities>();

export function getHostCapabilities(): HostCapabilities {
	const mode = getHostMode();
	let caps = capabilityCache.get(mode);
	if (!caps) {
		caps = hostCapabilitiesFor(mode);
		capabilityCache.set(mode, caps);
	}
	return caps;
}

const noopSubscribe = () => () => {};
const serverCaps = hostCapabilitiesFor("web");

export function useHostMode(): HostMode {
	return useSyncExternalStore(noopSubscribe, getHostMode, () => "web");
}

/** Stable per mode, so it is safe in dependency arrays. */
export function useHostCapabilities(): HostCapabilities {
	return useSyncExternalStore(
		noopSubscribe,
		getHostCapabilities,
		() => serverCaps,
	);
}
