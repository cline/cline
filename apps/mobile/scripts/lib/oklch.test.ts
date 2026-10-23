import { describe, expect, it } from "vitest";
import { isOklch, oklchToHex, parseOklch } from "./oklch";

/** Pull the numeric channels out of `#rrggbb[aa]` so tolerances can be per-channel. */
function channels(hex: string): number[] {
	const body = hex.slice(1);
	const out: number[] = [];
	for (let i = 0; i < body.length; i += 2) {
		out.push(Number.parseInt(body.slice(i, i + 2), 16));
	}
	return out;
}

function expectClose(actual: string, expected: string, tolerance = 1): void {
	const a = channels(actual);
	const e = channels(expected);
	expect(a).toHaveLength(e.length);
	for (const [i, value] of a.entries()) {
		expect(Math.abs(value - e[i])).toBeLessThanOrEqual(tolerance);
	}
}

describe("parseOklch", () => {
	it("parses the bare three-channel form", () => {
		expect(parseOklch("oklch(0.75 0.12 165)")).toEqual({
			l: 0.75,
			c: 0.12,
			h: 165,
			alpha: 1,
		});
	});

	it("parses the percentage alpha form", () => {
		expect(parseOklch("oklch(1 0 0 / 12%)")).toEqual({
			l: 1,
			c: 0,
			h: 0,
			alpha: 0.12,
		});
	});

	it("parses the decimal alpha form", () => {
		expect(parseOklch("oklch(0.5 0 0 / 0.5)")).toEqual({
			l: 0.5,
			c: 0,
			h: 0,
			alpha: 0.5,
		});
	});

	it("accepts a percentage lightness", () => {
		expect(parseOklch("oklch(75% 0.12 165)")?.l).toBeCloseTo(0.75, 10);
	});

	it("returns undefined for non-oklch values", () => {
		expect(parseOklch("rgb(0 0 0)")).toBeUndefined();
		expect(isOklch("rgb(0 0 0)")).toBe(false);
		expect(isOklch("  oklch(1 0 0)  ")).toBe(true);
	});
});

describe("oklchToHex", () => {
	it("maps the achromatic extremes exactly", () => {
		expect(oklchToHex("oklch(1 0 0)")).toBe("#ffffff");
		expect(oklchToHex("oklch(0 0 0)")).toBe("#000000");
	});

	it("keeps achromatic greys neutral", () => {
		const grey = oklchToHex("oklch(0.5 0 0)");
		const [r, g, b] = channels(grey);
		expect(r).toBe(g);
		expect(g).toBe(b);
		// oklch L=0.5 is a mid grey, well away from either extreme.
		expect(r).toBeGreaterThan(90);
		expect(r).toBeLessThan(140);
	});

	it("matches Tailwind v4's achromatic sRGB fallbacks exactly", () => {
		// Tailwind v4 ships both the oklch() value and an sRGB hex fallback for
		// every palette entry, which makes it a convenient independent oracle.
		expect(oklchToHex("oklch(0.145 0 0)")).toBe("#0a0a0a"); // neutral-950
		expect(oklchToHex("oklch(0.205 0 0)")).toBe("#171717"); // neutral-900
		expect(oklchToHex("oklch(0.269 0 0)")).toBe("#262626"); // neutral-800
		expect(oklchToHex("oklch(0.708 0 0)")).toBe("#a1a1a1"); // neutral-400
		expect(oklchToHex("oklch(0.922 0 0)")).toBe("#e5e5e5"); // neutral-200
		expect(oklchToHex("oklch(0.985 0 0)")).toBe("#fafafa"); // neutral-50
	});

	it("converts saturated chromatic values within one unit per channel", () => {
		// Tailwind v4 red ramp, oklch value -> published sRGB fallback.
		expectClose(oklchToHex("oklch(0.577 0.245 27.325)"), "#e7000b"); // red-600
		expectClose(oklchToHex("oklch(0.637 0.237 25.331)"), "#fb2c36"); // red-500
		expectClose(oklchToHex("oklch(0.704 0.191 22.216)"), "#ff6467"); // red-400
	});

	it("converts the Cline brand ramp within one unit per channel", () => {
		expectClose(oklchToHex("oklch(0.75 0.12 165)"), "#58c69b");
		expectClose(oklchToHex("oklch(0.65 0.13 165)"), "#1ea87b");
	});

	it("emits eight-digit hex for the alpha form", () => {
		expect(oklchToHex("oklch(1 0 0 / 12%)")).toBe("#ffffff1f");
		expect(oklchToHex("oklch(0 0 0 / 0.5)")).toBe("#00000080");
	});

	it("clamps out-of-gamut results instead of wrapping", () => {
		const hex = oklchToHex("oklch(0.9 0.4 140)");
		expect(hex).toMatch(/^#[0-9a-f]{6}$/);
		for (const value of channels(hex)) {
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThanOrEqual(255);
		}
	});

	it("throws on values it cannot parse", () => {
		expect(() => oklchToHex("not-a-color")).toThrow(/oklch/i);
	});
});
