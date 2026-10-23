/**
 * GENERATED FILE - do not edit by hand.
 *
 * Source:    design/theme.css (vendored snapshot of
 *            @cline/design-tokens src/theme.css)
 * SHA-256:   de1e6bd414cd32493d4aa2dbbbd31d285ad195e7d91bed02e3d6eddbe6789abf
 * Regenerate: bun run tokens:generate
 * Verify:     bun run tokens:check
 *
 * oklch() colors are converted to sRGB hex; rem lengths to px (1rem = 16).
 * Fonts, shadows, durations, easings and raw hsl triples pass through verbatim.
 */

export interface ThemeTokens {
	readonly color: {
		readonly brand500: string;
		readonly brand600: string;
		readonly canvas: string;
		readonly surface: string;
		readonly surfaceRaised: string;
		readonly surfaceMuted: string;
		readonly text: string;
		readonly textMuted: string;
		readonly border: string;
		readonly focus: string;
		readonly danger: string;
		readonly onBrand: string;
	};
	readonly font: {
		readonly sans: string;
		readonly mono: string;
	};
	readonly hsl: {
		readonly canvas: string;
		readonly surface: string;
		readonly surfaceRaised: string;
		readonly surfaceMuted: string;
		readonly text: string;
		readonly textMuted: string;
		readonly border: string;
		readonly brand: string;
		readonly focus: string;
		readonly danger: string;
		readonly onBrand: string;
	};
	readonly radius: {
		readonly sm: number;
		readonly md: number;
		readonly lg: number;
	};
	readonly shadow: {
		readonly raised: string;
	};
	readonly duration: {
		readonly fast: string;
		readonly normal: string;
	};
	readonly ease: {
		readonly standard: string;
	};
}

export const lightTokens = {
	color: {
		brand500: "#58c69b",
		brand600: "#1ea87b",
		canvas: "#ffffff",
		surface: "#fafafa",
		surfaceRaised: "#ffffff",
		surfaceMuted: "#f1f2f4",
		text: "#0a0a0a",
		textMuted: "#636363",
		border: "#e1e1e1",
		focus: "#58c69b",
		danger: "#e7000b",
		onBrand: "#00140c",
	},
	font: {
		sans: '"Schibsted Grotesk Variable", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
		mono: '"Azeret Mono Variable", "Azeret Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
	},
	hsl: {
		canvas: "0 0% 100%",
		surface: "240 20% 98%",
		surfaceRaised: "0 0% 100%",
		surfaceMuted: "240 11% 95%",
		text: "240 6% 9%",
		textMuted: "220 9% 46%",
		border: "220 13% 89%",
		brand: "157 47% 56%",
		focus: "157 47% 56%",
		danger: "0 72% 51%",
		onBrand: "157 70% 9%",
	},
	radius: {
		sm: 6,
		md: 8,
		lg: 12,
	},
	shadow: {
		raised: "0 1px 2px rgb(0 0 0 / 0.06), 0 8px 24px rgb(0 0 0 / 0.05)",
	},
	duration: {
		fast: "120ms",
		normal: "180ms",
	},
	ease: {
		standard: "cubic-bezier(0.2, 0, 0, 1)",
	},
} as const satisfies ThemeTokens;

export const darkTokens: ThemeTokens = {
	color: {
		brand500: "#58c69b",
		brand600: "#1ea87b",
		canvas: "#0a0a0a",
		surface: "#141414",
		surfaceRaised: "#171717",
		surfaceMuted: "#1f2023",
		text: "#fafafa",
		textMuted: "#a1a1a1",
		border: "#ffffff1f",
		focus: "#7cd2ae",
		danger: "#ff6467",
		onBrand: "#00140c",
	},
	font: {
		sans: '"Schibsted Grotesk Variable", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
		mono: '"Azeret Mono Variable", "Azeret Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
	},
	hsl: {
		canvas: "0 0% 4%",
		surface: "240 4% 8%",
		surfaceRaised: "240 4% 11%",
		surfaceMuted: "240 4% 15%",
		text: "0 0% 98%",
		textMuted: "220 7% 64%",
		border: "220 7% 24%",
		brand: "157 47% 56%",
		focus: "157 47% 56%",
		danger: "0 84% 60%",
		onBrand: "157 70% 9%",
	},
	radius: {
		sm: 6,
		md: 8,
		lg: 12,
	},
	shadow: {
		raised: "0 1px 2px rgb(0 0 0 / 0.35), 0 12px 32px rgb(0 0 0 / 0.22)",
	},
	duration: {
		fast: "120ms",
		normal: "180ms",
	},
	ease: {
		standard: "cubic-bezier(0.2, 0, 0, 1)",
	},
};
