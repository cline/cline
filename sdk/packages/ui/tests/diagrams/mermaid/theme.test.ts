// Exercises the theme module (design tokens, Mermaid config construction) of
// `components/diagrams/mermaid/` via the public façade.

import { describe, expect, test } from "vitest";
import {
	buildMermaidConfig,
	buildMermaidThemeVariables,
	createDefaultMermaidConfig,
	FALLBACK_MERMAID_TOKENS,
	MERMAID_FONT,
	normalizeMermaidTokens,
	resolveMermaidFontFamily,
} from "../../../components/mermaid-diagram";

const HEX = /^#[\da-f]{6}$/;

describe("Mermaid theme", () => {
	test("normalizes oklch tokens to hex and falls back per token", () => {
		const tokens = normalizeMermaidTokens(
			{
				...FALLBACK_MERMAID_TOKENS.light,
				background: "oklch(0.985 0 0)",
				primary: "oklch(0.55 0.22 293)",
				border: "var(--border)",
			},
			"light",
		);
		expect(tokens.primary).toBe("#7c49e3");
		expect(tokens.background).toMatch(HEX);
		expect(tokens.border).toBe(FALLBACK_MERMAID_TOKENS.light.border);
	});

	test.each([
		"light",
		"dark",
	] as const)("builds concrete hex theme variables for %s mode", (mode) => {
		const vars = buildMermaidThemeVariables(
			FALLBACK_MERMAID_TOKENS[mode],
			mode,
		);
		for (const [key, value] of Object.entries(vars)) {
			if (key === "darkMode" || key === "fontFamily" || key === "fontSize") {
				continue;
			}
			// Mermaid tints with khroma and the SVG is rasterized in an <img>:
			// every color must be concrete, never var(--x) / oklch().
			expect(value, key).toMatch(HEX);
		}
		expect(vars.darkMode).toBe(mode === "dark");
		expect(vars.background).toBe(FALLBACK_MERMAID_TOKENS[mode].background);
		expect(vars.textColor).toBe(FALLBACK_MERMAID_TOKENS[mode].foreground);
		expect(vars.lineColor).toBe(FALLBACK_MERMAID_TOKENS[mode].mutedForeground);
	});

	test("differs between light and dark and follows the accent", () => {
		const light = buildMermaidThemeVariables(
			FALLBACK_MERMAID_TOKENS.light,
			"light",
		);
		const dark = buildMermaidThemeVariables(
			FALLBACK_MERMAID_TOKENS.dark,
			"dark",
		);
		expect(light.primaryColor).not.toBe(dark.primaryColor);

		const cyan = buildMermaidThemeVariables(
			{ ...FALLBACK_MERMAID_TOKENS.light, primary: "oklch(0.6 0.12 222)" },
			"light",
		);
		expect(cyan.primaryColor).not.toBe(light.primaryColor);
		expect(cyan.primaryBorderColor).not.toBe(light.primaryBorderColor);
	});

	test("uses an Inter-first, non-monospace font stack", () => {
		expect(MERMAID_FONT.family.toLowerCase()).toContain("inter");
		expect(MERMAID_FONT.family.trim().toLowerCase()).not.toBe("monospace");
		expect(
			buildMermaidThemeVariables(FALLBACK_MERMAID_TOKENS.light, "light")
				.fontFamily,
		).toBe(MERMAID_FONT.family);
	});

	test("asks the injected resolver to resolve every token value", () => {
		const seen: string[] = [];
		const tokens = {
			background: "var(--card)",
			border: "var(--border)",
			error: "var(--destructive)",
			foreground: "var(--foreground)",
			muted: "var(--muted)",
			mutedForeground: "var(--muted-foreground)",
			primary: "var(--primary)",
		};
		const vars = buildMermaidThemeVariables(tokens, "dark", {
			resolveColor: (value) => {
				seen.push(value);
				return value === "var(--card)" ? "rgb(1, 2, 3)" : null;
			},
		});
		expect(new Set(seen)).toEqual(new Set(Object.values(tokens)));
		// Resolver output is normalized to hex; unresolved tokens use the palette.
		expect(vars.background).toBe("#010203");
		expect(vars.textColor).toBe(FALLBACK_MERMAID_TOKENS.dark.foreground);
	});

	test("honors a custom fontFamily and light/dark backgrounds differ", () => {
		const config = buildMermaidConfig(FALLBACK_MERMAID_TOKENS.light, "light", {
			fontFamily: "Georgia, serif",
		});
		expect(config.fontFamily).toBe("Georgia, serif");
		expect(config.themeVariables?.fontFamily).toBe("Georgia, serif");
		const dark = buildMermaidConfig(FALLBACK_MERMAID_TOKENS.dark, "dark");
		expect(dark.themeVariables?.background).not.toBe(
			config.themeVariables?.background,
		);
		for (const value of Object.values(dark.themeVariables ?? {})) {
			expect(["string", "boolean"]).toContain(typeof value);
		}
	});

	test("derives the font stack from --font-sans, never monospace", () => {
		expect(resolveMermaidFontFamily('"Inter Variable", sans-serif')).toBe(
			`'Inter Variable', sans-serif, ${MERMAID_FONT.family}`,
		);
		expect(resolveMermaidFontFamily("")).toBe(MERMAID_FONT.family);
		expect(resolveMermaidFontFamily(undefined)).toBe(MERMAID_FONT.family);
		expect(resolveMermaidFontFamily("ui-monospace, monospace")).toBe(
			MERMAID_FONT.family,
		);
		expect(resolveMermaidFontFamily('"A", serif')).not.toContain('"');
	});

	test("config uses the base theme, strict security, and SVG-text labels", () => {
		const config = buildMermaidConfig(FALLBACK_MERMAID_TOKENS.dark, "dark");
		expect(config).toMatchObject({
			fontFamily: MERMAID_FONT.family,
			// foreignObject labels taint canvases and break PNG export.
			htmlLabels: false,
			securityLevel: "strict",
			startOnLoad: false,
			suppressErrorRendering: true,
			theme: "base",
		});
		expect(config.themeVariables?.darkMode).toBe(true);
		// No per-node overrides: user init/classDef/style must win in Mermaid.
		expect(config).not.toHaveProperty("flowchart");
		expect(config).not.toHaveProperty("themeCSS");
	});

	test("default config is the light base theme", () => {
		expect(createDefaultMermaidConfig()).toEqual(
			buildMermaidConfig(FALLBACK_MERMAID_TOKENS.light, "light"),
		);
		expect(createDefaultMermaidConfig("dark").theme).toBe("base");
	});
});
