// Bumped from v1 when the default became a share of the main content area,
// so earlier fixed widths do not pin the panel narrow.
const WIDTH_STORAGE_KEY = "cline.code.workspace-panel-width.v2";
const FALLBACK_WIDTH = 680;
const MIN_WIDTH = 360;
const MIN_CONVERSATION_WIDTH = 420;
/** Share of the main content area the panel takes until the user drags it. */
const DEFAULT_SHARE = 0.6;

/** Width of the area beside the app sidebar that the panel shares with chat. */
export function mainContentWidth(): number {
	const main = document.querySelector<HTMLElement>(
		'[data-slot="sidebar-inset"]',
	);
	return main?.getBoundingClientRect().width || window.innerWidth;
}

/** Keeps the conversation column wide enough for the composer. */
export function clampWorkspacePanelWidth(width: number): number {
	const maxWidth = Math.max(
		MIN_WIDTH,
		mainContentWidth() - MIN_CONVERSATION_WIDTH,
	);
	return Math.min(maxWidth, Math.max(MIN_WIDTH, width));
}

function readStoredWidth(): number | null {
	try {
		const stored = Number(window.localStorage.getItem(WIDTH_STORAGE_KEY));
		return Number.isFinite(stored) && stored > 0 ? stored : null;
	} catch {
		return null;
	}
}

/** Whether the user has dragged the panel to a width of their own. */
export function hasStoredWorkspacePanelWidth(): boolean {
	return typeof window !== "undefined" && readStoredWidth() !== null;
}

/**
 * The user's dragged width, otherwise 60% of the main content area. Shared by
 * the panel and the placeholder shown while its code loads, so the layout
 * reserves the final width from the first frame.
 */
export function readWorkspacePanelWidth(): number {
	if (typeof window === "undefined") return FALLBACK_WIDTH;
	return clampWorkspacePanelWidth(
		readStoredWidth() ?? Math.round(mainContentWidth() * DEFAULT_SHARE),
	);
}

export function writeWorkspacePanelWidth(width: number): void {
	try {
		window.localStorage.setItem(WIDTH_STORAGE_KEY, String(Math.round(width)));
	} catch {
		// Not remembering the width is harmless.
	}
}
