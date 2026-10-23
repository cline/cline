/**
 * Resolve the actual desktop CSS roles so an upstream palette migration fails
 * this check instead of leaving mobile pinned to an obsolete list of colors.
 */
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";
import { brand, lightBrand } from "./brand";
import { borderAlpha, darkSurfaces, lightSurfaces, radii } from "./surfaces";
import { darkTokens } from "./tokens";

const themeDirectory = new URL(
	"../../../../sdk/packages/ui/theme/",
	import.meta.url,
);
const palette = readFileSync(new URL("palette.css", themeDirectory), "utf8");
const tokens = readFileSync(new URL("tokens.css", themeDirectory), "utf8");
function variablesFor(mode: "light" | "dark") {
	return new Map(
		[
			...(
				(mode === "dark"
					? palette.slice(palette.indexOf(".dark {"))
					: palette.slice(0, palette.indexOf(".dark {"))) + tokens
			).matchAll(/(--[\w-]+):\s*([^;]+);/g),
		].map((match) => [match[1], match[2].trim()]),
	);
}
function desktopValue(name: string, mode: "light" | "dark" = "dark"): string {
	const value = variablesFor(mode).get(name);
	if (!value) throw new Error(`Missing desktop token ${name}`);
	const reference = /^var\((--[\w-]+)\)$/.exec(value);
	return reference
		? desktopValue(reference[1], mode)
		: value === "#fff"
			? "#ffffff"
			: value;
}

describe("desktop theme parity", () => {
	it.each([
		"light",
		"dark",
	] as const)("maps mobile surfaces to desktop's %s semantic roles", (mode) => {
		const surfaces = mode === "dark" ? darkSurfaces : lightSurfaces;
		const mapping = {
			canvas: "--background",
			surface: "--sidebar",
			surfaceRaised: "--card",
			popover: "--popover",
			surfaceMuted: "--muted",
			surfaceHover: "--surface-hover",
			text: "--foreground",
			textMuted: "--muted-foreground",
			border: "--border",
			borderStrong: "--input",
			danger: "--destructive",
			onDanger: "--destructive-foreground",
			focus: "--ring",
			onBrand: "--primary-foreground",
		} as const;
		for (const [key, token] of Object.entries(mapping)) {
			expect(surfaces[key as keyof typeof mapping], key).toBe(
				desktopValue(token, mode),
			);
		}
	});
	it.each([
		"light",
		"dark",
	] as const)("uses desktop %s action colors", (mode) => {
		const currentBrand = mode === "dark" ? brand : lightBrand;
		expect(currentBrand.primary).toBe(desktopValue("--primary", mode));
		expect(currentBrand.primaryEmphasis).toBe(
			desktopValue("--primary-emphasis", mode),
		);
		expect(currentBrand.onPrimary).toBe(
			desktopValue("--primary-foreground", mode),
		);
		expect(currentBrand.ring).toBe(desktopValue("--ring", mode));
		expect(currentBrand.sendGradient).toEqual([
			currentBrand.primaryEmphasis,
			currentBrand.primary,
		]);
	});
});

describe("radii", () => {
	it("adds desktop's tightest step without resizing the existing rungs", () => {
		// `--radius: 0.5rem` → sm 4 / md 6 / lg 8 / xl 12. The generated sm/md/lg
		// (6/8/12) already land on desktop's 6/8/12, so only 4 was missing.
		expect(radii.xs).toBe(4);
		expect(radii.sm).toBe(darkTokens.radius.sm);
		expect(radii.md).toBe(darkTokens.radius.md);
		expect(radii.lg).toBe(darkTokens.radius.lg);
	});
});

describe("borderAlpha", () => {
	it("names desktop's color-mix fractions in ascending order", () => {
		expect([
			borderAlpha.faint,
			borderAlpha.soft,
			borderAlpha.medium,
			borderAlpha.strong,
		]).toEqual([0.4, 0.6, 0.7, 0.8]);
	});
});
