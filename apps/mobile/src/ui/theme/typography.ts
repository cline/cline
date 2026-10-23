import type { TextStyle } from "react-native";

/**
 * Loaded font-family names (see `fonts.ts`). Both are VARIABLE ttf fonts, so a
 * single family per typeface honors `fontWeight` on the new architecture — no
 * per-weight family juggling needed.
 */
export const fontFamily = {
	sans: "SchibstedGrotesk",
	mono: "AzeretMono",
} as const;

/**
 * RN weight strings. Desktop's variable weights (normal 480 / medium 560 /
 * semibold 640) are remapped to the standard RN ladder per DESIGN_SPEC §1.
 */
export const fontWeight = {
	normal: "400",
	medium: "500",
	semibold: "600",
	bold: "700",
} as const satisfies Record<string, TextStyle["fontWeight"]>;

export type TextVariant =
	| "hero"
	| "title"
	| "heading"
	| "bodyLarge"
	| "body"
	| "small"
	| "caption"
	| "mono";

/**
 * The type scale from `tokens.css` (DESIGN_SPEC §1). `letterSpacing` is em×size
 * converted to RN points; `lineHeight` in points. Body default is `sm` (14/20),
 * matching the desktop chat default.
 */
export const typography: Record<TextVariant, TextStyle> = {
	/*
	 * The welcome hero, from `agent-hero-heading.css`:
	 * `font-size: clamp(2rem, 3vw, 2.6rem)` (32–41.6) — a phone is at the floor,
	 * so 32; `line-height: 1.12` → 35.84; `letter-spacing: -0.025em` → -0.8;
	 * `font-weight: var(--font-weight-semibold)` (640, remapped to the RN 600).
	 */
	hero: {
		fontFamily: fontFamily.sans,
		fontSize: 32,
		lineHeight: 35.84,
		letterSpacing: -0.8,
		fontWeight: fontWeight.semibold,
	},
	// xl 20/28, -0.005em → screen/section titles
	title: {
		fontFamily: fontFamily.sans,
		fontSize: 20,
		lineHeight: 28,
		letterSpacing: -0.1,
		fontWeight: fontWeight.semibold,
	},
	// lg 18/26, -0.0025em → section headings
	heading: {
		fontFamily: fontFamily.sans,
		fontSize: 18,
		lineHeight: 26,
		letterSpacing: -0.045,
		fontWeight: fontWeight.semibold,
	},
	// base 16/24 → composer input, larger body
	bodyLarge: {
		fontFamily: fontFamily.sans,
		fontSize: 16,
		lineHeight: 24,
		fontWeight: fontWeight.normal,
	},
	// sm 14/20 → body / chat default, message text, tool labels
	body: {
		fontFamily: fontFamily.sans,
		fontSize: 14,
		lineHeight: 20,
		fontWeight: fontWeight.normal,
	},
	// xs 12/16, +0.0025em → timestamps, meta, diff counts, chips
	small: {
		fontFamily: fontFamily.sans,
		fontSize: 12,
		lineHeight: 16,
		letterSpacing: 0.03,
		fontWeight: fontWeight.normal,
	},
	// 11/14 → tightest meta (session time, footer bar)
	caption: {
		fontFamily: fontFamily.sans,
		fontSize: 11,
		lineHeight: 14,
		fontWeight: fontWeight.normal,
	},
	// xs mono → code, diff counts, token/cost stats
	mono: {
		fontFamily: fontFamily.mono,
		fontSize: 12,
		lineHeight: 16,
		fontWeight: fontWeight.normal,
	},
};
