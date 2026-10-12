const WIDTH_STORAGE_KEY = "cline.code.workspace-panel-width.v1";
const DEFAULT_WIDTH = 680;
const MIN_WIDTH = 440;

/** Leaves the conversation column at least as wide as the composer needs. */
export function clampWorkspacePanelWidth(width: number): number {
	const maxWidth = Math.max(MIN_WIDTH, window.innerWidth - 760);
	return Math.min(maxWidth, Math.max(MIN_WIDTH, width));
}

/**
 * Shared by the panel and the placeholder shown while its code loads, so
 * the layout reserves the final width from the first frame.
 */
export function readWorkspacePanelWidth(): number {
	if (typeof window === "undefined") return DEFAULT_WIDTH;
	let stored = Number.NaN;
	try {
		stored = Number(window.localStorage.getItem(WIDTH_STORAGE_KEY));
	} catch {
		// Unreadable storage falls back to the default width.
	}
	return clampWorkspacePanelWidth(
		Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_WIDTH,
	);
}

export function writeWorkspacePanelWidth(width: number): void {
	try {
		window.localStorage.setItem(WIDTH_STORAGE_KEY, String(Math.round(width)));
	} catch {
		// Not remembering the width is harmless.
	}
}
