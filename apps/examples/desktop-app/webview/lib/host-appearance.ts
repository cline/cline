"use client";

import { type AppFontSize, APP_FONT_SIZES, applyAppFontSize } from "@/lib/app-font-size";
import { getHostCapabilities } from "@/lib/host-mode";
import { applyHubTheme, type HubTheme } from "@/lib/theme";

/**
 * When the host owns appearance (VS Code), mirror its theme kind and font
 * size instead of the app's stored preferences.
 *
 * VS Code exposes both on the webview document:
 *   <body data-vscode-theme-kind="vscode-dark" ...>
 *   :root { --vscode-font-size: 13px; --vscode-font-family: ... }
 * and rewrites them in place when the user changes theme or zoom, so a
 * MutationObserver on <body> plus a resize listener keeps us in sync.
 */

/**
 * React hydration rewrites `<html>`/`<body>` attributes, so an embedding
 * host may snapshot its values onto this element instead (the VS Code
 * extension's bootstrap script does). Falls back to the live attributes.
 */
const HOST_APPEARANCE_MIRROR_ID = "cline-host-appearance";
export const HOST_APPEARANCE_EVENT = "cline-host-appearance";

function mirror(): HTMLElement | null {
	return document.getElementById(HOST_APPEARANCE_MIRROR_ID);
}

export function readHostTheme(): HubTheme | null {
	if (typeof document === "undefined") return null;
	const kind =
		mirror()?.dataset.themeKind ?? document.body?.dataset.vscodeThemeKind;
	if (kind === "vscode-dark" || kind === "vscode-high-contrast") return "dark";
	if (kind === "vscode-light" || kind === "vscode-high-contrast-light") {
		return "light";
	}
	return null;
}

/** Snap the host's font size to the app's supported steps. */
export function toAppFontSize(px: number): AppFontSize {
	let best: AppFontSize = APP_FONT_SIZES[0];
	for (const size of APP_FONT_SIZES) {
		if (Math.abs(size - px) < Math.abs(best - px)) best = size;
	}
	return best;
}

export function readHostFontSize(): AppFontSize | null {
	if (typeof document === "undefined") return null;
	const raw =
		mirror()?.dataset.fontSize ??
		getComputedStyle(document.documentElement)
			.getPropertyValue("--vscode-font-size")
			.trim();
	const px = Number.parseFloat(raw);
	if (!Number.isFinite(px) || px <= 0) return null;
	// VS Code's UI font is small (13px); the app is designed around 15px.
	// Scale rather than copy so the chat stays readable, but still follow zoom.
	return toAppFontSize(Math.round(px * (15 / 13)));
}

function applyFromHost(): void {
	const theme = readHostTheme();
	if (theme) applyHubTheme(theme);
	const fontSize = readHostFontSize();
	if (fontSize) applyAppFontSize(fontSize);
}

/**
 * Start following the host's appearance. No-op when the host does not own
 * it. Returns a disposer.
 */
export function syncHostAppearance(): () => void {
	const caps = getHostCapabilities();
	if (!caps.ownsTheme && !caps.ownsFontSize) return () => {};
	if (typeof document === "undefined") return () => {};
	applyFromHost();
	// The host's bootstrap announces changes; also watch <body> directly for
	// hosts that write the attribute without a mirror.
	document.addEventListener(HOST_APPEARANCE_EVENT, applyFromHost);
	const observer = new MutationObserver(applyFromHost);
	observer.observe(document.body, {
		attributes: true,
		attributeFilter: ["data-vscode-theme-kind"],
	});
	return () => {
		document.removeEventListener(HOST_APPEARANCE_EVENT, applyFromHost);
		observer.disconnect();
	};
}
