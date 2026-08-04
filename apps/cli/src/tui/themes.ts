import {
	diffPalettes,
	getDefaultForeground,
	getTerminalTheme,
	hexToOklab,
	oklabToHex,
	type TerminalTheme,
	themePalette,
} from "./palette";

// User-selectable color themes for the TUI.
//
// Three kinds of built-in themes exist:
//   - "auto" adapts to the terminal: it detects light/dark from the terminal's
//     reported background and keeps that background untouched (the pre-theme
//     behavior, and still the default).
//   - "dark" / "light" force the corresponding Cline palette and paint a
//     matching background, for terminals whose reported colors are missing or
//     wrong (see cline/cline#12872).
//   - Named themes (Tokyo Night, Gruvbox, ...) paint their canonical
//     background and bring their own accent + syntax palettes.

export interface ThemeAccents {
	act: string;
	plan: string;
	success: string;
	error: string;
}

export interface ThemeDiffPalette {
	addedBg: string;
	removedBg: string;
	addedLineNumberBg: string;
	removedLineNumberBg: string;
	addedSignColor: string;
	removedSignColor: string;
	lineNumberFg: string;
}

export interface ThemeSyntaxColors {
	keyword: string;
	operator: string;
	type: string;
	functionName: string;
	variable: string;
	string: string;
	number: string;
	comment: string;
	punctuation: string;
	property: string;
	constant: string;
	tag: string;
	attribute: string;
	escape: string;
	markdownCode: string;
	markdownMuted: string;
	markdownItalic: string;
	markdownDefault?: string;
}

// Dark syntax colors are a pastel family harmonized with the brand accents
// (act #79b8ff, plan #ffea7f, success #99e89b): every hue sits near the same
// OKLCH lightness/chroma weight (~L 0.78, C 0.11) so code blocks feel like
// part of the same palette instead of a bolted-on editor theme.
export const baseSyntaxColors: Record<TerminalTheme, ThemeSyntaxColors> = {
	dark: {
		keyword: "#d7a0e3",
		operator: "#9bbbdd",
		type: "#dfca7d",
		functionName: themePalette.dark.act,
		variable: "#ee939b",
		string: "#99e89b",
		number: "#f0ad7f",
		comment: "#5c6370",
		punctuation: "#abb2bf",
		property: "#ee939b",
		constant: "#f0ad7f",
		tag: "#ee939b",
		attribute: "#f0ad7f",
		escape: "#9bbbdd",
		markdownCode: "#99e89b",
		markdownMuted: "#808080",
		markdownItalic: "#dfca7d",
	},
	light: {
		keyword: "#cf222e",
		operator: "#0550ae",
		type: "#953800",
		functionName: "#8250df",
		variable: "#953800",
		string: "#0a3069",
		number: "#0550ae",
		comment: "#6e7781",
		punctuation: "#57606a",
		property: "#0550ae",
		constant: "#0550ae",
		tag: "#116329",
		attribute: "#0550ae",
		escape: "#0550ae",
		markdownCode: "#116329",
		markdownMuted: "#6e7781",
		markdownItalic: "#8250df",
		markdownDefault: "#1a1a1a",
	},
};

const baseAccents: Record<TerminalTheme, ThemeAccents> = {
	dark: { ...themePalette.dark, error: "#ef4444" },
	light: { ...themePalette.light, error: "#b42318" },
};

export interface ThemeDefinition {
	id: string;
	label: string;
	description: string;
	/** "auto" resolves to the detected terminal variant at runtime. */
	variant: TerminalTheme | "auto";
	/** Painted over the whole terminal; null keeps the terminal's background. */
	background: string | null;
	/** Default text color; null keeps the variant default. */
	foreground: string | null;
	accents?: Partial<ThemeAccents>;
	syntax?: Partial<ThemeSyntaxColors>;
	diff?: Partial<ThemeDiffPalette>;
}

export interface ResolvedTheme {
	id: string;
	label: string;
	variant: TerminalTheme;
	/** Explicit background painted over the terminal, or null to keep it. */
	appBackground: string | null;
	/** Background all adaptive colors derive from (theme's, else detected). */
	background: string | null;
	/** Default text color; undefined keeps the renderer default (white). */
	defaultForeground: string | undefined;
	/** Background for selected rows/buttons on the main themed surface. */
	selection: string;
	/** Text color readable on top of `selection`. */
	textOnSelection: string;
	accents: ThemeAccents;
	diff: ThemeDiffPalette;
	syntax: ThemeSyntaxColors;
}

export const AUTO_THEME_ID = "auto";

export const THEMES: readonly ThemeDefinition[] = [
	{
		id: AUTO_THEME_ID,
		label: "Auto",
		description: "Adapts to your terminal's colors",
		variant: "auto",
		background: null,
		foreground: null,
	},
	{
		id: "dark",
		label: "Cline Dark",
		description: "Cline's accents on deep charcoal",
		variant: "dark",
		background: "#14161b",
		foreground: "#e8eaed",
	},
	{
		id: "light",
		label: "Cline Light",
		description: "Crisp white, high-contrast accents",
		variant: "light",
		background: "#ffffff",
		foreground: "#1a1a1a",
	},
	{
		id: "tokyo-night",
		label: "Tokyo Night",
		description: "Moody blues and neon city glow",
		variant: "dark",
		background: "#1a1b26",
		foreground: "#c0caf5",
		accents: {
			act: "#7aa2f7",
			plan: "#e0af68",
			success: "#9ece6a",
			error: "#f7768e",
		},
		syntax: {
			keyword: "#bb9af7",
			operator: "#89ddff",
			type: "#2ac3de",
			functionName: "#7aa2f7",
			variable: "#c0caf5",
			string: "#9ece6a",
			number: "#ff9e64",
			comment: "#565f89",
			punctuation: "#a9b1d6",
			property: "#73daca",
			constant: "#ff9e64",
			tag: "#f7768e",
			attribute: "#bb9af7",
			escape: "#89ddff",
			markdownCode: "#9ece6a",
			markdownMuted: "#565f89",
			markdownItalic: "#e0af68",
			markdownDefault: "#c0caf5",
		},
	},
	{
		id: "gruvbox-dark",
		label: "Gruvbox Dark",
		description: "Retro warmth, earthy and amber",
		variant: "dark",
		background: "#282828",
		foreground: "#ebdbb2",
		accents: {
			act: "#83a598",
			plan: "#fabd2f",
			success: "#b8bb26",
			error: "#fb4934",
		},
		syntax: {
			keyword: "#fb4934",
			operator: "#fe8019",
			type: "#fabd2f",
			functionName: "#b8bb26",
			variable: "#83a598",
			string: "#b8bb26",
			number: "#d3869b",
			comment: "#928374",
			punctuation: "#ebdbb2",
			property: "#83a598",
			constant: "#d3869b",
			tag: "#8ec07c",
			attribute: "#fabd2f",
			escape: "#fe8019",
			markdownCode: "#b8bb26",
			markdownMuted: "#928374",
			markdownItalic: "#fabd2f",
			markdownDefault: "#ebdbb2",
		},
	},
	{
		id: "nord",
		label: "Nord",
		description: "Cool arctic blues and frosted teals",
		variant: "dark",
		background: "#2e3440",
		foreground: "#d8dee9",
		accents: {
			act: "#88c0d0",
			plan: "#ebcb8b",
			success: "#a3be8c",
			error: "#bf616a",
		},
		syntax: {
			keyword: "#81a1c1",
			operator: "#81a1c1",
			type: "#8fbcbb",
			functionName: "#88c0d0",
			variable: "#d8dee9",
			string: "#a3be8c",
			number: "#b48ead",
			comment: "#616e88",
			punctuation: "#eceff4",
			property: "#8fbcbb",
			constant: "#b48ead",
			tag: "#81a1c1",
			attribute: "#8fbcbb",
			escape: "#ebcb8b",
			markdownCode: "#a3be8c",
			markdownMuted: "#616e88",
			markdownItalic: "#ebcb8b",
			markdownDefault: "#d8dee9",
		},
	},
	{
		id: "dracula",
		label: "Dracula",
		description: "Vivid color on a dark violet night",
		variant: "dark",
		background: "#282a36",
		foreground: "#f8f8f2",
		accents: {
			act: "#bd93f9",
			plan: "#f1fa8c",
			success: "#50fa7b",
			error: "#ff5555",
		},
		syntax: {
			keyword: "#ff79c6",
			operator: "#ff79c6",
			type: "#8be9fd",
			functionName: "#50fa7b",
			variable: "#f8f8f2",
			string: "#f1fa8c",
			number: "#bd93f9",
			comment: "#6272a4",
			punctuation: "#f8f8f2",
			property: "#8be9fd",
			constant: "#bd93f9",
			tag: "#ff79c6",
			attribute: "#50fa7b",
			escape: "#ff79c6",
			markdownCode: "#f1fa8c",
			markdownMuted: "#6272a4",
			markdownItalic: "#ffb86c",
			markdownDefault: "#f8f8f2",
		},
	},
	{
		id: "catppuccin-mocha",
		label: "Catppuccin Mocha",
		description: "Soothing pastels on warm mocha",
		variant: "dark",
		background: "#1e1e2e",
		foreground: "#cdd6f4",
		accents: {
			act: "#89b4fa",
			plan: "#f9e2af",
			success: "#a6e3a1",
			error: "#f38ba8",
		},
		syntax: {
			keyword: "#cba6f7",
			operator: "#89dceb",
			type: "#f9e2af",
			functionName: "#89b4fa",
			variable: "#cdd6f4",
			string: "#a6e3a1",
			number: "#fab387",
			comment: "#6c7086",
			punctuation: "#9399b2",
			property: "#94e2d5",
			constant: "#fab387",
			tag: "#f38ba8",
			attribute: "#f9e2af",
			escape: "#f5c2e7",
			markdownCode: "#a6e3a1",
			markdownMuted: "#6c7086",
			markdownItalic: "#f9e2af",
			markdownDefault: "#cdd6f4",
		},
	},
	{
		id: "one-dark",
		label: "One Dark",
		description: "Atom's balanced, easygoing dark",
		variant: "dark",
		background: "#282c34",
		foreground: "#abb2bf",
		accents: {
			act: "#61afef",
			plan: "#e5c07b",
			success: "#98c379",
			error: "#e06c75",
		},
		syntax: {
			keyword: "#c678dd",
			operator: "#56b6c2",
			type: "#e5c07b",
			functionName: "#61afef",
			variable: "#e06c75",
			string: "#98c379",
			number: "#d19a66",
			comment: "#5c6370",
			punctuation: "#abb2bf",
			property: "#e06c75",
			constant: "#d19a66",
			tag: "#e06c75",
			attribute: "#d19a66",
			escape: "#56b6c2",
			markdownCode: "#98c379",
			markdownMuted: "#5c6370",
			markdownItalic: "#e5c07b",
			markdownDefault: "#abb2bf",
		},
	},
	{
		id: "solarized-dark",
		label: "Solarized Dark",
		description: "Low-glare teal depths, easy on eyes",
		variant: "dark",
		background: "#002b36",
		foreground: "#93a1a1",
		accents: {
			act: "#268bd2",
			plan: "#b58900",
			success: "#859900",
			error: "#dc322f",
		},
		syntax: {
			keyword: "#859900",
			operator: "#93a1a1",
			type: "#b58900",
			functionName: "#268bd2",
			variable: "#268bd2",
			string: "#2aa198",
			number: "#d33682",
			comment: "#586e75",
			punctuation: "#93a1a1",
			property: "#268bd2",
			constant: "#cb4b16",
			tag: "#268bd2",
			attribute: "#93a1a1",
			escape: "#cb4b16",
			markdownCode: "#2aa198",
			markdownMuted: "#586e75",
			markdownItalic: "#6c71c4",
			markdownDefault: "#93a1a1",
		},
	},
	{
		id: "solarized-light",
		label: "Solarized Light",
		description: "Warm parchment with muted accents",
		variant: "light",
		background: "#fdf6e3",
		foreground: "#657b83",
		accents: {
			act: "#268bd2",
			plan: "#b58900",
			success: "#859900",
			error: "#dc322f",
		},
		syntax: {
			keyword: "#859900",
			operator: "#657b83",
			type: "#b58900",
			functionName: "#268bd2",
			variable: "#268bd2",
			string: "#2aa198",
			number: "#d33682",
			comment: "#93a1a1",
			punctuation: "#657b83",
			property: "#268bd2",
			constant: "#cb4b16",
			tag: "#268bd2",
			attribute: "#586e75",
			escape: "#cb4b16",
			markdownCode: "#2aa198",
			markdownMuted: "#93a1a1",
			markdownItalic: "#6c71c4",
			markdownDefault: "#657b83",
		},
	},
] as const;

const THEMES_BY_ID = new Map(THEMES.map((theme) => [theme.id, theme]));

export function getThemeDefinition(id: string): ThemeDefinition | undefined {
	return THEMES_BY_ID.get(id);
}

export function normalizeThemeId(id: string | undefined | null): string {
	const trimmed = id?.trim().toLowerCase();
	return trimmed && THEMES_BY_ID.has(trimmed) ? trimmed : AUTO_THEME_ID;
}

// Below this WCAG relative luminance, white text has the higher contrast
// ratio against the background; above it, black does. Derived from
// (L + 0.05)^2 = 1.05 * 0.05.
const WHITE_TEXT_LUMINANCE_CUTOFF = 0.179;

function relativeLuminance(hex: string): number {
	const channel = (offset: number) => {
		const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function mixHex(base: string, tint: string, amount: number): string {
	const a = hexToOklab(base);
	const b = hexToOklab(tint);
	return oklabToHex(
		a.L + (b.L - a.L) * amount,
		a.a + (b.a - a.a) * amount,
		a.b + (b.b - a.b) * amount,
	);
}

// Diff rows tint the theme background toward the theme's own green/red so
// diffs feel native to every theme instead of reusing one fixed palette.
function deriveDiffPalette(
	background: string,
	foreground: string,
	accents: ThemeAccents,
): ThemeDiffPalette {
	return {
		addedBg: mixHex(background, accents.success, 0.22),
		removedBg: mixHex(background, accents.error, 0.22),
		addedLineNumberBg: mixHex(background, accents.success, 0.3),
		removedLineNumberBg: mixHex(background, accents.error, 0.3),
		addedSignColor: accents.success,
		removedSignColor: accents.error,
		lineNumberFg: mixHex(foreground, background, 0.4),
	};
}

export interface DetectedTerminalColors {
	background: string | null;
	foreground: string | null;
}

export function resolveTheme(
	id: string,
	detected: DetectedTerminalColors,
): ResolvedTheme {
	const definition =
		getThemeDefinition(normalizeThemeId(id)) ?? (THEMES[0] as ThemeDefinition);
	const variant: TerminalTheme =
		definition.variant === "auto"
			? getTerminalTheme(detected.background, detected.foreground)
			: definition.variant;
	const appBackground = definition.background;
	const background = appBackground ?? detected.background;
	const accents: ThemeAccents = {
		...baseAccents[variant],
		...definition.accents,
	};
	const syntax: ThemeSyntaxColors = {
		...baseSyntaxColors[variant],
		...(definition.foreground
			? { markdownDefault: definition.foreground }
			: {}),
		...definition.syntax,
	};
	const diff: ThemeDiffPalette = {
		...(appBackground && definition.foreground
			? deriveDiffPalette(appBackground, definition.foreground, accents)
			: diffPalettes[variant]),
		...definition.diff,
	};
	// Selected rows highlight with the act accent; the text on top flips
	// between black and white, picking whichever has the higher WCAG
	// contrast ratio against the accent.
	const selection = accents.act;
	const textOnSelection =
		relativeLuminance(selection) > WHITE_TEXT_LUMINANCE_CUTOFF
			? "#000000"
			: "#ffffff";
	return {
		id: definition.id,
		label: definition.label,
		variant,
		appBackground,
		background,
		defaultForeground:
			definition.foreground ?? getDefaultForeground(background),
		selection,
		textOnSelection,
		accents,
		diff,
		syntax,
	};
}

export function getThemeModeAccent(theme: ResolvedTheme, mode: string): string {
	return mode === "plan" ? theme.accents.plan : theme.accents.act;
}

/**
 * Dialog surfaces are always dark, so light-variant themes (whose accents are
 * darkened for contrast on light backgrounds) fall back to the dark accent
 * set for readable dialog content.
 */
export function getDialogAccents(theme: ResolvedTheme): ThemeAccents {
	return theme.variant === "dark" ? theme.accents : baseAccents.dark;
}

/** Small color strip rendered next to each entry in the theme picker. */
export function getThemeSwatchColors(definition: ThemeDefinition): string[] {
	const variant = definition.variant === "auto" ? "dark" : definition.variant;
	const accents = { ...baseAccents[variant], ...definition.accents };
	return [accents.act, accents.plan, accents.success, accents.error];
}
