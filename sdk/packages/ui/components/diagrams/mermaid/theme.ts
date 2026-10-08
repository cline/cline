import type { MermaidConfig } from "mermaid";
import { cssColorToHex, mixColors } from "./color.js";
import { MERMAID_FONT, THEME_MIX } from "./config.js";

/**
 * The Cline Mermaid theme: resolved design tokens, the Mermaid `base`-theme
 * variables derived from them and the site-level config builders. Pure and
 * DOM-free; the browser glue that samples live tokens is `dom.ts`.
 */

// ---------------------------------------------------------------------------
// Mermaid theme
// ---------------------------------------------------------------------------

export type MermaidColorMode = "dark" | "light";

/** Resolved Cline design tokens the diagram theme is derived from. */
export interface MermaidThemeTokens {
	/** Diagram surface (`--card`); also the PNG background fill. */
	background: string;
	border: string;
	/** Destructive/error role color (`--destructive`). */
	error: string;
	foreground: string;
	muted: string;
	mutedForeground: string;
	/** Accent (`--primary`); follows the user's accent palette. */
	primary: string;
}

/** Palette values from `theme/palette.css`, used when tokens can't be read. */
export const FALLBACK_MERMAID_TOKENS: Record<
	MermaidColorMode,
	MermaidThemeTokens
> = {
	dark: {
		background: "#18191b",
		border: "#2f2f37",
		error: "#e54666",
		foreground: "#fcfcfd",
		muted: "#212225",
		mutedForeground: "#b0b4ba",
		primary: "#6e56cf",
	},
	light: {
		background: "#f9f9fb",
		border: "#e8e8ec",
		error: "#e54666",
		foreground: "#1c2024",
		muted: "#f0f0f3",
		mutedForeground: "#60646c",
		primary: "#6e56cf",
	},
};

/**
 * Font stack for a raw `--font-sans` value (`"Inter Variable", sans-serif`).
 * Double quotes become single quotes so the stack survives Mermaid's inline
 * `style="..."` attributes, and the Inter-first system stack is appended so
 * text still measures sensibly before the web font loads. An empty or
 * monospace value falls back to `MERMAID_FONT.family`.
 */
export function resolveMermaidFontFamily(
	cssFontValue: string | null | undefined,
): string {
	const value = cssFontValue?.trim().replace(/"/g, "'") ?? "";
	if (!value || /\bmonospace\b/i.test(value)) return MERMAID_FONT.family;
	return `${value}, ${MERMAID_FONT.family}`;
}

export type MermaidThemeVariables = Record<string, string | boolean>;

/**
 * Resolves a CSS color (`oklch(...)`, `var(--x)`, named, ...) to `#rrggbb`, or
 * returns null when it can't. Hosts with a DOM can pass a canvas/computed-style
 * backed resolver; tests can pass a stub. Consulted before the built-in parser.
 */
export type MermaidColorResolver = (cssValue: string) => string | null;

export interface MermaidThemeOptions {
	/** Overrides the UI font stack; defaults to `MERMAID_FONT.family`. */
	fontFamily?: string;
	/** Optional host resolver for colors the pure parser can't read. */
	resolveColor?: MermaidColorResolver;
}

function hexOr(
	value: string,
	fallback: string,
	resolveColor: MermaidColorResolver | undefined,
): string {
	const resolved = resolveColor?.(value);
	const hex = resolved ? cssColorToHex(resolved) : null;
	return hex ?? cssColorToHex(value) ?? fallback;
}

/** Normalizes every token to `#rrggbb`, substituting palette fallbacks. */
export function normalizeMermaidTokens(
	tokens: MermaidThemeTokens,
	mode: MermaidColorMode,
	resolveColor?: MermaidColorResolver,
): MermaidThemeTokens {
	const fallback = FALLBACK_MERMAID_TOKENS[mode];
	return {
		background: hexOr(tokens.background, fallback.background, resolveColor),
		border: hexOr(tokens.border, fallback.border, resolveColor),
		error: hexOr(tokens.error, fallback.error, resolveColor),
		foreground: hexOr(tokens.foreground, fallback.foreground, resolveColor),
		muted: hexOr(tokens.muted, fallback.muted, resolveColor),
		mutedForeground: hexOr(
			tokens.mutedForeground,
			fallback.mutedForeground,
			resolveColor,
		),
		primary: hexOr(tokens.primary, fallback.primary, resolveColor),
	};
}

/**
 * Mermaid `base`-theme variables from concrete sRGB colors. Mermaid derives the
 * rest (git/pie/state colors, ...) from these. Concrete hex is required:
 * Mermaid tints colors with khroma, and the exported SVG is rasterized in an
 * `<img>` that can't resolve `var(--x)`.
 */
export function buildMermaidThemeVariables(
	tokens: MermaidThemeTokens,
	mode: MermaidColorMode,
	{ fontFamily = MERMAID_FONT.family, resolveColor }: MermaidThemeOptions = {},
): MermaidThemeVariables {
	const t = normalizeMermaidTokens(tokens, mode, resolveColor);
	const dark = mode === "dark";
	const mix = THEME_MIX[mode];
	const nodeFill = mixColors(t.background, t.primary, mix.node);
	const nodeBorder = mixColors(t.background, t.primary, mix.nodeBorder);
	const neutralFill = mixColors(t.background, t.foreground, mix.neutral);
	const clusterFill = mixColors(t.background, t.foreground, mix.cluster);
	const tertiaryFill = mixColors(t.background, t.primary, mix.tertiary);
	const errorFill = mixColors(t.background, t.error, mix.error);

	return {
		activationBkgColor: neutralFill,
		activationBorderColor: t.border,
		actorBkg: nodeFill,
		actorBorder: nodeBorder,
		actorLineColor: t.mutedForeground,
		actorTextColor: t.foreground,
		background: t.background,
		clusterBkg: clusterFill,
		clusterBorder: t.border,
		darkMode: dark,
		edgeLabelBackground: t.background,
		errorBkgColor: errorFill,
		errorTextColor: t.error,
		fontFamily,
		fontSize: MERMAID_FONT.size,
		labelBoxBkgColor: neutralFill,
		labelBoxBorderColor: t.border,
		labelTextColor: t.foreground,
		lineColor: t.mutedForeground,
		loopTextColor: t.foreground,
		mainBkg: nodeFill,
		nodeBorder,
		noteBkgColor: t.muted,
		noteBorderColor: t.border,
		noteTextColor: t.foreground,
		primaryBorderColor: nodeBorder,
		primaryColor: nodeFill,
		primaryTextColor: t.foreground,
		secondaryBorderColor: t.border,
		secondaryColor: neutralFill,
		secondaryTextColor: t.foreground,
		sequenceNumberColor: t.background,
		signalColor: t.mutedForeground,
		signalTextColor: t.foreground,
		tertiaryBorderColor: t.border,
		tertiaryColor: tertiaryFill,
		tertiaryTextColor: t.foreground,
		textColor: t.foreground,
		titleColor: t.foreground,
	};
}

/**
 * Site-level Mermaid config for the Cline theme. User `%%{init}%%`, frontmatter
 * `config:`, `classDef` and `style` layer on top of this inside Mermaid, so
 * nothing here is forced per node. `htmlLabels: false` keeps labels as SVG
 * `<text>` instead of `<foreignObject>`, which taints canvases in WebKit and
 * would make PNG export fail in the Tauri webview.
 */
export function buildMermaidConfig(
	tokens: MermaidThemeTokens,
	mode: MermaidColorMode,
	options: MermaidThemeOptions = {},
): MermaidConfig {
	return {
		fontFamily: options.fontFamily ?? MERMAID_FONT.family,
		htmlLabels: false,
		securityLevel: "strict",
		startOnLoad: false,
		suppressErrorRendering: true,
		theme: "base",
		themeVariables: buildMermaidThemeVariables(tokens, mode, options),
	};
}

/** Base-theme defaults from the palette, for hosts with no DOM to sample. */
export function createDefaultMermaidConfig(
	mode: MermaidColorMode = "light",
): MermaidConfig {
	return buildMermaidConfig(FALLBACK_MERMAID_TOKENS[mode], mode);
}
