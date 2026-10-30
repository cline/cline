import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCssColor } from "../components/mermaid-diagram";
import {
	deriveAlphaColor,
	generatePaletteAlpha,
	paletteNames,
} from "../scripts/palette-alpha";

const palette = readFileSync(
	fileURLToPath(new URL("../theme/palette.css", import.meta.url)),
	"utf8",
);

function declarations(source: string) {
	return Object.fromEntries(
		Array.from(
			source.matchAll(/--([\w-]+):\s*([^;]+);/g),
			([, name, value]) => [name, value.trim()],
		),
	);
}

function color(value: string) {
	const parsed = parseCssColor(value);
	if (!parsed) throw new Error(`Invalid CSS color: ${value}`);
	return parsed;
}

describe("derived palette alpha colors", () => {
	it("keeps all 144 alpha/solid pairs within 3/255 over each mode's neutral-1", () => {
		let checked = 0;
		for (const [, mode, body] of palette.matchAll(
			/^(:root|\.dark) \{([\s\S]*?)^\}/gm,
		)) {
			const values = declarations(body);
			const background = color(values["neutral-1"]);
			for (const name of paletteNames) {
				for (let step = 1; step <= 12; step += 1) {
					const solid = color(values[`${name}-${step}`]);
					const overlay = color(values[`${name}-a${step}`]);
					expect(overlay.a).toBeGreaterThanOrEqual(0);
					expect(overlay.a).toBeLessThanOrEqual(1);
					for (const channel of ["r", "g", "b"] as const) {
						const composite =
							overlay[channel] * overlay.a +
							background[channel] * (1 - overlay.a);
						expect(
							Math.abs(composite - solid[channel]),
							`${mode} --${name}-a${step} ${channel}`,
						).toBeLessThanOrEqual(3);
					}
					checked += 1;
				}
			}
		}
		expect(checked).toBe(144);
	});

	it("is deterministic and updates only alpha values after an authored solid changes", () => {
		expect(generatePaletteAlpha(palette)).toBe(palette);
		const edited = palette.replace(
			"--accent-9: oklch(55% 0.22 279);",
			"--accent-9: oklch(56% 0.21 278);",
		);
		expect(edited).not.toBe(palette);
		const generated = generatePaletteAlpha(edited);
		expect(generated).not.toBe(edited);
		expect(generatePaletteAlpha(generated)).toBe(generated);
		const withoutAlphaValues = (source: string) =>
			source.replace(/(--[a-z]+-a\d+:\s*)[^;]+;/g, "$1<derived>;");
		expect(withoutAlphaValues(generated)).toBe(withoutAlphaValues(edited));
	});

	it("uses transparent overlays for identical colors and opaque gamut boundaries", () => {
		expect(deriveAlphaColor("#fff", "#fff")).toBe("oklch(0% 0 0 / 0)");
		for (const [solid, background] of [
			["#f00", "#fff"],
			["#fff", "#000"],
			["#000", "#fff"],
		]) {
			const generated = color(deriveAlphaColor(solid, background));
			const expected = color(solid);
			expect(generated.a).toBe(1);
			for (const channel of ["r", "g", "b"] as const) {
				expect(generated[channel]).toBeCloseTo(expected[channel], 2);
			}
		}
	});

	it("rejects incomplete palettes instead of silently skipping derived colors", () => {
		expect(() =>
			generatePaletteAlpha(palette.replace(/--error-a9:[^;]+;/, "")),
		).toThrow("Missing :root --error-a9");
		expect(() =>
			generatePaletteAlpha(palette.replace(".dark {", ".light {")),
		).toThrow("Expected :root and .dark palettes");
	});
});
