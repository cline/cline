import { parseCssColor } from "../components/mermaid-diagram";

export const paletteNames = [
	"neutral",
	"accent",
	"error",
	"success",
	"warning",
	"info",
] as const;

type Rgb = [number, number, number];

function srgbBytes(value: string): Rgb {
	const color = parseCssColor(value);
	if (!color || color.a !== 1) {
		throw new Error(`Expected an opaque palette color: ${value}`);
	}
	// Match the existing renderer's sRGB channel clipping, then the browser's
	// 8-bit sRGB canvas output. Authored OKLCH solids remain unchanged.
	return [color.r, color.g, color.b].map(Math.round) as Rgb;
}

function srgbToOklch(rgb: Rgb): [number, number, number] {
	const [r, g, b] = rgb.map((channel) => {
		const value = channel / 255;
		return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	});
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
	const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
	const opponentB = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
	const chroma = Math.hypot(a, opponentB);
	const hue =
		chroma < 0.000001
			? 0
			: ((Math.atan2(opponentB, a) * 180) / Math.PI + 360) % 360;
	return [lightness * 100, chroma, hue];
}

const format = (value: number) => String(Number(value.toFixed(6)));

/** Smallest 8-bit opacity whose sRGB foreground can reproduce the solid. */
export function deriveAlphaColor(solid: string, background: string): string {
	const target = srgbBytes(solid);
	const backdrop = srgbBytes(background);
	const minimumAlpha = Math.max(
		...target.map((channel, index) => {
			const behind = backdrop[index];
			if (channel === behind) return 0;
			return channel > behind
				? (channel - behind) / (255 - behind)
				: (behind - channel) / behind;
		}),
	);
	// Gamut-edge solids may need alpha 1; identical colors need no overlay.
	const alpha = Math.ceil(minimumAlpha * 255) / 255;
	if (alpha === 0) return "oklch(0% 0 0 / 0)";
	const foreground = target.map((channel, index) =>
		Math.round((channel - backdrop[index] * (1 - alpha)) / alpha),
	) as Rgb;
	const [lightness, chroma, hue] = srgbToOklch(foreground);
	return `oklch(${format(lightness)}% ${format(chroma)} ${format(hue)} / ${format(alpha)})`;
}

/** Replace only alpha values; authored solids, comments, and order are preserved. */
export function generatePaletteAlpha(source: string): string {
	const modes = new Set<string>();
	const generated = source.replace(
		/^(:root|\.dark) \{([\s\S]*?)^\}/gm,
		(rule, selector: string, body: string) => {
			if (modes.has(selector)) throw new Error(`Duplicate ${selector} palette`);
			modes.add(selector);
			const values = new Map<string, string>();
			for (const [, name, value] of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
				if (values.has(name))
					throw new Error(`Duplicate ${selector} --${name}`);
				values.set(name, value.trim());
			}
			const expectedNames = paletteNames.flatMap((name) =>
				Array.from({ length: 12 }, (_, index) => `${name}-${index + 1}`),
			);
			for (const name of expectedNames) {
				for (const token of [name, name.replace(/-(\d+)$/, "-a$1")]) {
					if (!values.has(token)) {
						throw new Error(`Missing ${selector} --${token}`);
					}
				}
			}
			const background = values.get("neutral-1");
			if (!background) throw new Error(`Missing ${selector} --neutral-1`);
			return rule.replace(
				/(--([a-z]+)-a(\d+):\s*)[^;]+;/g,
				(_: string, prefix: string, name: string, step: string) => {
					const solid = values.get(`${name}-${step}`);
					if (!solid) throw new Error(`Missing ${selector} --${name}-${step}`);
					return `${prefix}${deriveAlphaColor(solid, background)};`;
				},
			);
		},
	);
	if (modes.size !== 2) throw new Error("Expected :root and .dark palettes");
	return generated;
}
