"use client";

import { useEffect } from "react";

function isEditable(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) {
		return false;
	}
	return Boolean(target.closest("input, textarea, [contenteditable='true']"));
}

function hasTextSelection(): boolean {
	const selection = window.getSelection();
	return Boolean(selection && !selection.isCollapsed);
}

/**
 * Suppresses the WebView's built-in browser context menu (Back / Forward /
 * Reload / Inspect Element) so right-clicking app chrome behaves like a
 * native app instead of a web page.
 *
 * Radix context menus (e.g. on sidebar sessions) attach their own
 * `contextmenu` handlers on their triggers and call `preventDefault`
 * themselves, so they keep working. Editable fields and active text
 * selections keep the default menu for spellcheck / copy / paste.
 */
export function NativeShell() {
	useEffect(() => {
		const handleContextMenu = (event: MouseEvent) => {
			if (isEditable(event.target) || hasTextSelection()) {
				return;
			}
			event.preventDefault();
		};
		// Non-capture: runs after component-level handlers, so custom menus
		// that already prevented default are unaffected either way.
		window.addEventListener("contextmenu", handleContextMenu);
		return () => window.removeEventListener("contextmenu", handleContextMenu);
	}, []);
	return null;
}
