import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	buildThemes,
	classifyVariable,
	emitTokensModule,
	parseThemeCss,
	THEME_CSS_PATH,
	type TokenValue,
} from "./css-tokens";

const css = readFileSync(THEME_CSS_PATH, "utf8");

/** Assert-and-narrow, so string assertions below stay type-safe. */
function str(value: TokenValue): string {
	expect(typeof value).toBe("string");
	return value as string;
}

/** Every `--cline-*` custom property declared anywhere in the vendored sheet. */
function declaredVariables(source: string): string[] {
	return [...source.matchAll(/(--cline-[a-z0-9-]+)\s*:/g)].map((m) => m[1]);
}

describe("classifyVariable", () => {
	it("splits the kind from the camelCased key", () => {
		expect(classifyVariable("--cline-color-surface-raised")).toEqual({
			kind: "color",
			key: "surfaceRaised",
		});
		expect(classifyVariable("--cline-color-brand-500")).toEqual({
			kind: "color",
			key: "brand500",
		});
		expect(classifyVariable("--cline-font-sans")).toEqual({
			kind: "font",
			key: "sans",
		});
		expect(classifyVariable("--cline-hsl-on-brand")).toEqual({
			kind: "hsl",
			key: "onBrand",
		});
		expect(classifyVariable("--cline-ease-standard")).toEqual({
			kind: "ease",
			key: "standard",
		});
	});

	it("ignores properties outside the cline namespace", () => {
		expect(classifyVariable("color-scheme")).toBeUndefined();
		expect(classifyVariable("--other-color-x")).toBeUndefined();
	});
});

describe("parseThemeCss", () => {
	it("collects the :root block as light and the .dark block as overrides", () => {
		const { light, dark } = parseThemeCss(css);
		expect(light.get("--cline-color-canvas")).toBe("oklch(1 0 0)");
		expect(dark.get("--cline-color-canvas")).toBe("oklch(0.145 0 0)");
		// `--cline-font-sans` is only declared once, in :root.
		expect(light.has("--cline-font-sans")).toBe(true);
		expect(dark.has("--cline-font-sans")).toBe(false);
	});

	it("collapses multi-line values onto one line", () => {
		const { light } = parseThemeCss(css);
		expect(light.get("--cline-shadow-raised")).toBe(
			"0 1px 2px rgb(0 0 0 / 0.06), 0 8px 24px rgb(0 0 0 / 0.05)",
		);
		expect(light.get("--cline-font-mono")).not.toMatch(/[\n\t]/);
	});

	it("drops non-custom properties such as color-scheme", () => {
		const { dark } = parseThemeCss(css);
		expect([...dark.keys()].every((k) => k.startsWith("--cline-"))).toBe(true);
	});

	it("strips comments rather than treating them as declarations", () => {
		const { light } = parseThemeCss(
			":root { /* --cline-color-fake: red; */ --cline-color-real: oklch(1 0 0); }",
		);
		expect(light.has("--cline-color-fake")).toBe(false);
		expect(light.has("--cline-color-real")).toBe(true);
	});
});

describe("buildThemes", () => {
	const { light, dark } = buildThemes(css);

	it("exposes every declared variable in both themes", () => {
		const names = declaredVariables(css);
		expect(names.length).toBeGreaterThan(30);
		for (const name of names) {
			const classified = classifyVariable(name);
			expect(classified, name).toBeDefined();
			if (!classified) continue;
			const { kind, key } = classified;
			expect(light[kind], `light.${kind} missing for ${name}`).toBeDefined();
			expect(Object.hasOwn(light[kind], key), `light.${kind}.${key}`).toBe(
				true,
			);
			expect(dark[kind], `dark.${kind} missing for ${name}`).toBeDefined();
			expect(Object.hasOwn(dark[kind], key), `dark.${kind}.${key}`).toBe(true);
		}
	});

	it("gives the two themes identical shapes", () => {
		expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
		for (const kind of Object.keys(light)) {
			expect(Object.keys(dark[kind]).sort(), kind).toEqual(
				Object.keys(light[kind]).sort(),
			);
		}
	});

	it("inherits undeclared values from light into dark", () => {
		// The dark block never redeclares the brand ramp, the fonts, the radii or
		// the durations, so they must be inherited verbatim.
		expect(dark.color.brand500).toBe(light.color.brand500);
		expect(dark.color.brand600).toBe(light.color.brand600);
		expect(dark.font.sans).toBe(light.font.sans);
		expect(dark.radius.md).toBe(light.radius.md);
		expect(dark.duration.fast).toBe(light.duration.fast);
		expect(dark.ease.standard).toBe(light.ease.standard);
	});

	it("overrides only what the dark block declares", () => {
		expect(dark.color.canvas).not.toBe(light.color.canvas);
		expect(dark.color.text).not.toBe(light.color.text);
		expect(dark.shadow.raised).not.toBe(light.shadow.raised);
	});

	it("converts oklch colors to hex", () => {
		expect(light.color.canvas).toBe("#ffffff");
		expect(light.color.text).toMatch(/^#[0-9a-f]{6}$/);
		expect(dark.color.canvas).toMatch(/^#[0-9a-f]{6}$/);
	});

	it("keeps the alpha channel for translucent colors", () => {
		// `--cline-color-border: oklch(1 0 0 / 12%)` in the dark block.
		expect(dark.color.border).toMatch(/^#[0-9a-f]{8}$/);
		expect(str(dark.color.border).startsWith("#ffffff")).toBe(true);
	});

	it("resolves var() indirection inside the same theme", () => {
		// `--cline-color-focus: var(--cline-color-brand-500)` in :root.
		expect(light.color.focus).toBe(light.color.brand500);
		// The dark block declares its own focus colour.
		expect(dark.color.focus).not.toBe(light.color.focus);
	});

	it("converts rem lengths to numeric pixels", () => {
		expect(light.radius.sm).toBe(6);
		expect(light.radius.md).toBe(8);
		expect(light.radius.lg).toBe(12);
	});

	it("passes fonts, shadows, durations and easings through as raw strings", () => {
		expect(typeof light.font.sans).toBe("string");
		expect(light.font.sans).toContain("Schibsted Grotesk Variable");
		expect(light.duration.fast).toBe("120ms");
		expect(light.duration.normal).toBe("180ms");
		expect(light.ease.standard).toBe("cubic-bezier(0.2, 0, 0, 1)");
		expect(light.shadow.raised).toContain("rgb(0 0 0 / 0.06)");
	});

	it("keeps raw hsl channel triples verbatim", () => {
		expect(light.hsl.canvas).toBe("0 0% 100%");
		expect(dark.hsl.canvas).toBe("0 0% 4%");
	});
});

describe("emitTokensModule", () => {
	const source = emitTokensModule(buildThemes(css), "de1e6bd4");

	it("emits a generated-file banner naming the source hash", () => {
		expect(source).toContain("GENERATED FILE");
		expect(source).toContain("de1e6bd4");
	});

	it("exports the documented surface", () => {
		expect(source).toContain("export interface ThemeTokens");
		expect(source).toContain("export const lightTokens = {");
		expect(source).toContain("} as const satisfies ThemeTokens;");
		expect(source).toContain("export const darkTokens: ThemeTokens = {");
	});

	it("is deterministic", () => {
		expect(emitTokensModule(buildThemes(css), "de1e6bd4")).toBe(source);
	});

	it("ends with exactly one trailing newline", () => {
		expect(source.endsWith("};\n")).toBe(true);
		expect(source.endsWith("\n\n")).toBe(false);
	});
});
