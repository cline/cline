export const TERMINAL_PANEL_STORAGE_KEY = "cline.code.terminal-panel.v1";

export const TERMINAL_PANEL_MIN_HEIGHT = 120;
export const TERMINAL_PANEL_DEFAULT_HEIGHT = 280;

export type TerminalPanelState = {
	open: boolean;
	height: number;
};

export function parseTerminalPanelState(
	raw: string | null,
): TerminalPanelState {
	const fallback = { open: false, height: TERMINAL_PANEL_DEFAULT_HEIGHT };
	if (!raw) return fallback;
	try {
		const parsed = JSON.parse(raw) as Partial<TerminalPanelState> | null;
		if (!parsed || typeof parsed !== "object") return fallback;
		return {
			open: parsed.open === true,
			height:
				typeof parsed.height === "number" && Number.isFinite(parsed.height)
					? Math.max(TERMINAL_PANEL_MIN_HEIGHT, Math.round(parsed.height))
					: fallback.height,
		};
	} catch {
		return fallback;
	}
}

export function readTerminalPanelState(): TerminalPanelState {
	if (typeof window === "undefined") {
		return { open: false, height: TERMINAL_PANEL_DEFAULT_HEIGHT };
	}
	try {
		return parseTerminalPanelState(
			window.localStorage.getItem(TERMINAL_PANEL_STORAGE_KEY),
		);
	} catch {
		return { open: false, height: TERMINAL_PANEL_DEFAULT_HEIGHT };
	}
}

export function writeTerminalPanelState(state: TerminalPanelState): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(
			TERMINAL_PANEL_STORAGE_KEY,
			JSON.stringify(state),
		);
	} catch {
		// Storage unavailable: the panel just starts closed next launch.
	}
}

/** Keeps the panel from swallowing the whole window or collapsing to nothing. */
export function clampTerminalPanelHeight(
	height: number,
	viewportHeight: number,
): number {
	const max = Math.max(
		TERMINAL_PANEL_MIN_HEIGHT,
		Math.floor(viewportHeight * 0.8),
	);
	return Math.min(max, Math.max(TERMINAL_PANEL_MIN_HEIGHT, Math.round(height)));
}
