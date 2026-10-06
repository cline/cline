// Exercises the color module (CSS color parsing/conversion) of
// `components/diagrams/mermaid/` via the public façade.

import { describe, expect, test } from "vitest";
import {
	cssColorToHex,
	mixColors,
	parseCssColor,
} from "../../../components/mermaid-diagram";

describe("color conversion", () => {
	test.each([
		["oklch(1 0 0)", "#ffffff"],
		["oklch(0 0 0)", "#000000"],
		["oklch(0.5 0 0)", "#636363"],
		// sRGB primaries expressed in oklch round-trip exactly.
		["oklch(0.628 0.2577 29.23)", "#ff0000"],
		["oklch(0.452 0.313 264.05)", "#0000ff"],
		["oklch(0.55 0.22 293)", "#7c49e3"],
		["oklch(55% 0.22 293deg)", "#7c49e3"],
		["#6e56cf", "#6e56cf"],
		["#FFF", "#ffffff"],
		["rgb(110, 86, 207)", "#6e56cf"],
		["rgb(110 86 207 / 50%)", "#6e56cf"],
		["rgba(110,86,207,0.5)", "#6e56cf"],
		["color(srgb 1 0.5 0)", "#ff8000"],
	])("%s -> %s", (input, expected) => {
		expect(cssColorToHex(input)).toBe(expected);
	});

	test("clamps out-of-gamut oklch to valid sRGB", () => {
		expect(cssColorToHex("oklch(0.7 0.5 150)")).toMatch(/^#[\da-f]{6}$/);
	});

	test("keeps alpha for callers that need it", () => {
		expect(parseCssColor("rgb(0 0 0 / 25%)")?.a).toBeCloseTo(0.25);
		expect(parseCssColor("rgba(0,0,0,.5)")?.a).toBeCloseTo(0.5);
		expect(parseCssColor("#00000080")?.a).toBeCloseTo(0.5, 1);
	});

	test.each([
		"",
		"var(--card)",
		"color-mix(in srgb, red 50%, blue)",
		"color(display-p3 1 0 0)",
		"not-a-color",
		"oklch(0.5 foo 10)",
	])("rejects %j so callers can fall back", (input) => {
		expect(cssColorToHex(input)).toBeNull();
	});

	test("mixes colors in sRGB and tolerates unparseable input", () => {
		expect(mixColors("#000000", "#ffffff", 0.5)).toBe("#808080");
		expect(mixColors("#101010", "#ffffff", 0)).toBe("#101010");
		expect(mixColors("#101010", "#ffffff", 1)).toBe("#ffffff");
		expect(mixColors("#101010", "var(--x)", 0.5)).toBe("#101010");
		expect(mixColors("var(--x)", "#ffffff", 0.5)).toBe("var(--x)");
	});
});
