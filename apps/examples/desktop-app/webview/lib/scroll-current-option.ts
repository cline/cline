"use client";

/**
 * Centers the row marked `data-current="true"` inside a picker's scrollable
 * list, so opening a long list (e.g. branches) starts at the selection
 * instead of the top. Mirrors the shared SearchCombobox's open behavior.
 * No-ops when the row is absent or scrollIntoView is unavailable (jsdom).
 */
export function scrollCurrentOptionIntoView(
	container: HTMLElement | null,
): void {
	const current = container?.querySelector<HTMLElement>(
		'[data-current="true"]',
	);
	if (current && typeof current.scrollIntoView === "function") {
		current.scrollIntoView({ block: "center" });
	}
}
