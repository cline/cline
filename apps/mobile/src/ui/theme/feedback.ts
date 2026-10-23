/**
 * Semantic feedback tones — the amber / blue / red / green accents the chat
 * surface needs for banners, state icons and tool-activity states
 * (DESIGN_SPEC §4 "State summary for tool cards" + §6 approval/ask-question
 * frames).
 *
 * Why here and not in `@/theme/tokens.ts`: that file is GENERATED from
 * `design/theme.css` and hash-guarded by `tokens:check`, and its palette has no
 * amber/blue at all. Desktop writes these accents as literal Tailwind colors
 * (`amber-500 #f59e0b`, `amber-400/40`, `blue-500 #3b82f6`) rather than theme
 * vars, so they are reproduced here as a small named family — the same
 * arrangement `StatusDot`'s `STATUS_DOT_COLOR` already uses — instead of being
 * sprinkled as raw hex through the screens.
 *
 * Each tone carries the three values desktop actually composes with: a
 * foreground for the icon/label, a ~10% `subtle` fill, and a ~40% `border`.
 */

import { withAlpha } from "@/theme/brand";
import { darkSurfaces, lightSurfaces } from "@/theme/surfaces";
import { darkTokens } from "@/theme/tokens";

export type FeedbackTone =
	| "info"
	| "warning"
	| "danger"
	| "success"
	| "neutral";

export interface FeedbackColors {
	/** Icon / label color. */
	readonly fg: string;
	/** ~10% fill for a banner or state medallion. */
	readonly subtle: string;
	/** ~40% border for a framed panel. */
	readonly border: string;
}

/** amber-500 — approval frames, "attention" banners (DESIGN_SPEC §6). */
const AMBER = "#f59e0b";
/** amber-400 — the lighter stop desktop borders approval frames with. */
const AMBER_BORDER = "#fbbf24";
/** blue-500 — the ask-question frame (DESIGN_SPEC §6). */
const BLUE = "#3b82f6";

export const feedback: Record<FeedbackTone, FeedbackColors> = {
	info: {
		fg: BLUE,
		subtle: withAlpha(BLUE, 0.1),
		border: withAlpha(BLUE, 0.4),
	},
	warning: {
		fg: AMBER,
		subtle: withAlpha(AMBER, 0.1),
		border: withAlpha(AMBER_BORDER, 0.4),
	},
	danger: {
		fg: darkSurfaces.danger,
		subtle: withAlpha(darkSurfaces.danger, 0.1),
		border: withAlpha(darkSurfaces.danger, 0.4),
	},
	// `brand500` is the generated green — desktop's `--chart-2` "additions" tone.
	success: {
		fg: darkTokens.color.brand500,
		subtle: withAlpha(darkTokens.color.brand500, 0.1),
		border: withAlpha(darkTokens.color.brand500, 0.4),
	},
	neutral: {
		fg: darkSurfaces.textMuted,
		subtle: darkSurfaces.surfaceMuted,
		border: darkSurfaces.border,
	},
};

/**
 * Liveness/state dot colors. Desktop writes these as literal Tailwind palette
 * values too (`bg-green-500`, `bg-red-500`, …) rather than theme vars, so they
 * live here beside the other feedback literals instead of inside a component.
 */
export type StatusTone = "neutral" | "running" | "error" | "pending" | "unread";

export const STATUS_DOT_COLOR: Record<StatusTone, string> = {
	/** gray-500 */
	neutral: "#6b7280",
	/** green-500 */
	running: "#22c55e",
	/** red-500 */
	error: "#ef4444",
	/** yellow-400 */
	pending: "#facc15",
	/** blue-500 */
	unread: "#3b82f6",
};

export const lightFeedback: Record<FeedbackTone, FeedbackColors> = {
	info: { fg: "#00749e", subtle: "#e1f6fd", border: "#8dcae3" },
	warning: { fg: "#ab6400", subtle: "#fff7c2", border: "#e9c162" },
	danger: { fg: "#ca244d", subtle: "#feeaed", border: "#efacb8" },
	success: { fg: "#218358", subtle: "#e6f6eb", border: "#8eceaa" },
	neutral: {
		fg: lightSurfaces.textMuted,
		subtle: lightSurfaces.surfaceMuted,
		border: lightSurfaces.border,
	},
};
