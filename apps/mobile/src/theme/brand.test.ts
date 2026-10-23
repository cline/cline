import { describe, expect, it } from "vitest";
import { brand, withAlpha } from "./brand";

describe("withAlpha", () => {
	it("converts #rrggbb to rgba at the given alpha", () => {
		expect(withAlpha("#a684f9", 0.1)).toBe("rgba(166, 132, 249, 0.1)");
	});

	it("expands #rgb shorthand", () => {
		expect(withAlpha("#fff", 0.5)).toBe("rgba(255, 255, 255, 0.5)");
	});

	it("overrides the alpha byte of #rrggbbaa", () => {
		// #ffffff1f is the border token (white @12%); ask for 60% of that base.
		expect(withAlpha("#ffffff1f", 0.072)).toBe("rgba(255, 255, 255, 0.072)");
	});

	it("clamps alpha into 0..1", () => {
		expect(withAlpha("#000000", 5)).toBe("rgba(0, 0, 0, 1)");
		expect(withAlpha("#000000", -1)).toBe("rgba(0, 0, 0, 0)");
	});
});

describe("brand palette", () => {
	it("uses the desktop violet primary, not the green token", () => {
		// --primary oklch(0.7 0.17 293) and --primary-foreground oklch(0.16 0.015 285),
		// converted by scripts/lib/oklch.ts — not DESIGN_SPEC's eyeballed hexes.
		expect(brand.violet).toBe("#a486fd");
		expect(brand.onViolet).toBe("#0c0c14");
		expect(brand.ring).toBe("#6958ad");
	});

	it("derives the alpha accents from the violet primary", () => {
		expect(brand.violetSubtle).toBe("rgba(164, 134, 253, 0.1)");
		expect(brand.violetBorder).toBe("rgba(164, 134, 253, 0.5)");
	});

	it("exposes the aurora family and hero gradient stops", () => {
		expect(brand.aurora).toMatchObject({
			lilac: "#b67ecf",
			magenta: "#c360bc",
			periwinkle: "#6f7de8",
			cyan: "#58b4c4",
		});
		// Desktop's 135deg periwinkle -> violet 55% -> magenta hero clip.
		expect(brand.heroGradient).toEqual(["#6f7de8", "#a486fd", "#c360bc"]);
	});

	it("keeps the aurora-on-dark variants lighter than the artwork tones", () => {
		// Raw aurora fills are too dark to read as text on the canvas, so the
		// on-dark family lifts the same hues to oklch L 0.76-0.84.
		expect(brand.auroraOnDark).toMatchObject({
			lilac: "#dda4f7",
			magenta: "#ec86e4",
			periwinkle: "#91a3ff",
			cyan: "#80dbeb",
		});
	});
});
