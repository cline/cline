export const SUGGESTION_EXPOSURE_MS = 400;
export const SUGGESTION_STALE_NOTE_MS = 4_000;
export const SUGGESTION_SEND_VERDICT_MS = 300;
/** An optimistic skip or refresh with no reply after this long is undone. */
export const SUGGESTION_PENDING_UNDO_MS = 2_000;
export const SUGGESTION_BREAKPOINTS = {
	/** px (0eebe5ba) */
	desktop: { narrowBelow: 520, compactBelow: 400 },
	/** px (f6c4aea8) */
	ide: { narrowBelow: 520, compactBelow: 280 },
	/** columns (ea57871f) */
	cli: { narrowBelow: 80, compactBelow: 60 },
} as const;
