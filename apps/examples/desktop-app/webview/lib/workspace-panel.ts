const WIDTH_STORAGE_KEYS = {
	workspace: "cline.code.workspace-panel-width.v2",
	side: "cline.code.side-chat-width.v1",
};
export type WorkspacePanelKind = keyof typeof WIDTH_STORAGE_KEYS;
const FALLBACK_WIDTHS = { workspace: 680, side: 440 };
const MIN_WIDTH = 360;
const MIN_CONVERSATION_WIDTH = 420;
/** Share of the main content area the panel takes until the user drags it. */
const DEFAULT_SHARES = { workspace: 0.6, side: 0.4 };

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

function readStoredWidth(panel: WorkspacePanelKind): number | null {
	try {
		const stored = Number(
			window.localStorage.getItem(WIDTH_STORAGE_KEYS[panel]),
		);
		return Number.isFinite(stored) && stored > 0 ? stored : null;
	} catch {
		return null;
	}
}

/**
 * The user's dragged width, otherwise the panel's default share of the content area.
 * Clamp only the rendered width so widening restores the saved preference.
 */
export function readWorkspacePanelWidth(
	panel: WorkspacePanelKind = "workspace",
): number {
	if (typeof window === "undefined") return FALLBACK_WIDTHS[panel];
	return clampWorkspacePanelWidth(
		readStoredWidth(panel) ??
			Math.round(mainContentWidth() * DEFAULT_SHARES[panel]),
	);
}

export function writeWorkspacePanelWidth(
	width: number,
	panel: WorkspacePanelKind = "workspace",
): void {
	try {
		window.localStorage.setItem(
			WIDTH_STORAGE_KEYS[panel],
			String(Math.round(width)),
		);
	} catch {
		// Not remembering the width is harmless.
	}
}
