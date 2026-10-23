/**
 * Native mapping of @cline/ui/theme/{tokens,palette}.css dark semantic roles.
 * Desktop now uses the shared Slate/Violet palette. Keep these values aligned
 * with that source, rather than the older generated mobile design snapshot.
 */

import { darkTokens, lightTokens, type ThemeTokens } from "./tokens";

/**
 * The structural colors a component paints with. Superset of the generated
 * `ThemeTokens["color"]`: adds the ramp rungs and the on-fill foregrounds the
 * generated snapshot has no equivalent for.
 */
export type SurfaceColors = ThemeTokens["color"] & {
	/** `--popover` — sheets and floating panels. */
	readonly popover: string;
	/** `--surface-hover` — composable pressed/hover overlay. */
	readonly surfaceHover: string;
	/** `--input` — the stronger hairline on entry fields. */
	readonly borderStrong: string;
	/** `--destructive-foreground` — text/icon on a solid `danger` fill. */
	readonly onDanger: string;
};

/**
 * Desktop `.dark` → RN. Left column is the `@cline/ui` custom property each
 * value is taken from; the ramp climbs canvas → surface → raised → muted → hover.
 */
export const darkSurfaces: SurfaceColors = {
	...darkTokens.color,
	canvas: "#121216", // --background / --neutral-1
	surface: "#18191b", // --sidebar / --neutral-2
	surfaceRaised: "#18191b", // --card / --neutral-2
	popover: "#18191b", // --popover / --neutral-2
	surfaceMuted: "#212225", // --muted / --neutral-3
	surfaceHover: "#ddeaf814", // --surface-hover / --neutral-a3
	text: "#fcfcfd", // --foreground / --neutral-12
	textMuted: "#b0b4ba", // --muted-foreground / --neutral-11
	border: "#2f2f37", // --border / --neutral-4
	borderStrong: "#2e3135", // --input / --neutral-5
	danger: "#e54666", // --destructive / --error-9
	onDanger: "#ffffff",
	focus: "#6958ad", // --ring / --accent-8
	onBrand: "#ffffff", // --primary-foreground
};

/** Desktop light Slate surfaces and Violet focus ring. */
export const lightSurfaces: SurfaceColors = {
	...lightTokens.color,
	canvas: "#fcfcfd",
	surface: "#f9f9fb",
	surfaceRaised: "#f9f9fb",
	popover: "#f9f9fb",
	surfaceMuted: "#f0f0f3",
	surfaceHover: "#0000330b",
	text: "#1c2024",
	textMuted: "#60646c",
	border: "#e8e8ec",
	borderStrong: "#e0e1e6",
	danger: "#e54666",
	onDanger: "#ffffff",
	focus: "#aa99ec",
	onBrand: "#ffffff",
};

/**
 * Corner radii, desktop-exact. `--radius` is `0.5rem`, giving
 * `sm 4 / md 6 / lg 8 / xl 12`.
 *
 * The generated `tokens.radius` is `sm 6 / md 8 / lg 12`, i.e. the same three
 * usable steps under names shifted one rung down — so `radius.sm/md/lg` already
 * land on desktop's 6/8/12 and are left alone rather than silently resized under
 * ~29 call sites. Only desktop's tightest step (`calc(var(--radius) - 4px)` = 4,
 * used for chat bubbles and inline tool code) had no rung at all; that is `xs`.
 */
export type SurfaceRadii = ThemeTokens["radius"] & {
	/** 4px — desktop `--radius-sm`: chat bubbles, inline tool code. */
	readonly xs: number;
	/** Fully rounded — pills and dots. */
	readonly pill: number;
};

export const radii: SurfaceRadii = {
	...darkTokens.radius,
	xs: 4,
	pill: 999,
};

/**
 * Non-palette color channels: the opaque/transparent stops a `MaskedView`
 * gradient needs (mask luminance, not a theme color) and the RN shadow cast.
 * Named here so no component has to spell a raw hex.
 */
export const channel = {
	/** Fully visible in a mask gradient. */
	maskOpaque: "#000000",
	/** Fully clipped in a mask gradient, and the `transparent` fill keyword. */
	maskClear: "transparent",
	/** Shadow cast color (`shadow.raised` is black at low alpha). */
	shadow: "#000000",
} as const;

/**
 * Border alphas desktop composes with, as opacity fractions of the border color
 * (`color-mix(in oklab, var(--border) N%, transparent)`). Named so screens stop
 * passing bare numbers around.
 */
export const borderAlpha = {
	/** `border@40%` — the faintest divider desktop uses. */
	faint: 0.4,
	/** `border@60%` — quick-action group, welcome cards. */
	soft: 0.6,
	/** `border@70%` — tool code blocks. */
	medium: 0.7,
	/** `border@80%` — dividers between rows inside a group. */
	strong: 0.8,
} as const;
