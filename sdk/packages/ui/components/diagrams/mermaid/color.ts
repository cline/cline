/**
 * CSS color parsing and conversion for the Mermaid theme: hex, rgb()/rgba(),
 * oklch()/oklab() and color(srgb ...) to concrete sRGB. Pure and DOM-free so
 * it can be unit-tested in Node; hosts with a DOM fall back to canvas-based
 * conversion in `dom.ts` when these return null.
 */

// ---------------------------------------------------------------------------
// Color parsing / conversion
// ---------------------------------------------------------------------------

/** sRGB channels in 0-255 (may be fractional) plus alpha in 0-1. */
export interface RgbaColor {
	a: number;
	b: number;
	g: number;
	r: number;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function parseAlpha(token: string | undefined): number {
	const trimmed = token?.trim();
	if (!trimmed || trimmed === "none") return 1;
	const value = trimmed.endsWith("%")
		? Number.parseFloat(trimmed) / 100
		: Number.parseFloat(trimmed);
	return Number.isFinite(value) ? clamp(value, 0, 1) : 1;
}

function parseChannel(token: string, percentScale: number): number | null {
	if (token === "none") return 0;
	const value = Number.parseFloat(token);
	if (!Number.isFinite(value)) return null;
	return token.endsWith("%") ? (value / 100) * percentScale : value;
}

function parseHue(token: string): number | null {
	if (token === "none") return 0;
	const value = Number.parseFloat(token);
	if (!Number.isFinite(value)) return null;
	if (token.endsWith("turn")) return value * 360;
	if (token.endsWith("grad")) return value * 0.9;
	if (token.endsWith("rad")) return (value * 180) / Math.PI;
	return value;
}

function encodeSrgb(linear: number): number {
	const value = clamp(linear, 0, 1);
	const encoded =
		value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
	return clamp(encoded, 0, 1) * 255;
}

function oklabToRgb(
	lightness: number,
	a: number,
	b: number,
): [number, number, number] {
	const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
	return [
		encodeSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
		encodeSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
		encodeSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
	];
}

function parseHex(value: string): RgbaColor | null {
	const match = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.exec(value);
	if (!match) return null;
	let hex = match[1] ?? "";
	if (hex.length <= 4) hex = [...hex].map((char) => char + char).join("");
	const channel = (offset: number) =>
		Number.parseInt(hex.slice(offset, offset + 2), 16);
	return {
		a: hex.length === 8 ? channel(6) / 255 : 1,
		b: channel(4),
		g: channel(2),
		r: channel(0),
	};
}

function splitFunctionArgs(inner: string): {
	alpha: string | undefined;
	tokens: string[];
} {
	const [main = "", alpha] = inner.replace(/,/g, " ").split("/");
	return { alpha, tokens: main.trim().split(/\s+/).filter(Boolean) };
}

function parseRgbFunction(tokens: string[], a: number): RgbaColor | null {
	if (tokens.length < 3) return null;
	const channels = tokens.slice(0, 3).map((token) => parseChannel(token, 255));
	const [r, g, b] = channels;
	if (r === null || g === null || b === null) return null;
	if (r === undefined || g === undefined || b === undefined) return null;
	return {
		a,
		b: clamp(b, 0, 255),
		g: clamp(g, 0, 255),
		r: clamp(r, 0, 255),
	};
}

function parseOklabFamily(
	name: "oklab" | "oklch",
	tokens: string[],
	a: number,
): RgbaColor | null {
	if (tokens.length < 3) return null;
	const lightness = parseChannel(tokens[0] ?? "", 1);
	if (lightness === null) return null;
	let opponentA: number | null;
	let opponentB: number | null;
	if (name === "oklch") {
		const chroma = parseChannel(tokens[1] ?? "", 0.4);
		const hue = parseHue(tokens[2] ?? "");
		if (chroma === null || hue === null) return null;
		const radians = (hue * Math.PI) / 180;
		opponentA = chroma * Math.cos(radians);
		opponentB = chroma * Math.sin(radians);
	} else {
		opponentA = parseChannel(tokens[1] ?? "", 0.4);
		opponentB = parseChannel(tokens[2] ?? "", 0.4);
	}
	if (opponentA === null || opponentB === null) return null;
	const [r, g, b] = oklabToRgb(clamp(lightness, 0, 1), opponentA, opponentB);
	return { a, b, g, r };
}

function parseColorSrgb(tokens: string[], a: number): RgbaColor | null {
	if ((tokens[0] ?? "").toLowerCase() !== "srgb") return null;
	const channels = tokens.slice(1, 4).map((token) => parseChannel(token, 1));
	const [r, g, b] = channels;
	if (r == null || g == null || b == null) return null;
	return {
		a,
		b: clamp(b, 0, 1) * 255,
		g: clamp(g, 0, 1) * 255,
		r: clamp(r, 0, 1) * 255,
	};
}

/**
 * Parses the color syntaxes `getComputedStyle` and our tokens produce:
 * `#rgb[a]`/`#rrggbb[aa]`, `rgb()/rgba()`, `oklch()`, `oklab()` and
 * `color(srgb ...)`. Returns `null` for anything else so callers can fall back
 * to a canvas-based conversion or a palette default.
 */
export function parseCssColor(input: string): RgbaColor | null {
	const value = input.trim();
	if (!value) return null;
	const hex = parseHex(value);
	if (hex) return hex;

	const fn = /^([a-z-]+)\(([^)]*)\)$/i.exec(value);
	if (!fn) return null;
	const name = (fn[1] ?? "").toLowerCase();
	const { alpha, tokens } = splitFunctionArgs(fn[2] ?? "");
	const a = parseAlpha(alpha);

	if (name === "rgb" || name === "rgba") {
		// Legacy comma syntax carries alpha as a 4th positional argument.
		const legacyAlpha = alpha === undefined ? tokens[3] : undefined;
		return parseRgbFunction(tokens, legacyAlpha ? parseAlpha(legacyAlpha) : a);
	}
	if (name === "oklch" || name === "oklab") {
		return parseOklabFamily(name, tokens, a);
	}
	if (name === "color") return parseColorSrgb(tokens, a);
	return null;
}

function toChannelHex(value: number): string {
	return Math.round(clamp(value, 0, 255))
		.toString(16)
		.padStart(2, "0");
}

export function rgbToHex(color: Pick<RgbaColor, "b" | "g" | "r">): string {
	return `#${toChannelHex(color.r)}${toChannelHex(color.g)}${toChannelHex(color.b)}`;
}

/** Any supported CSS color to `#rrggbb`, or `null` when unparseable. */
export function cssColorToHex(input: string): string | null {
	const parsed = parseCssColor(input);
	return parsed ? rgbToHex(parsed) : null;
}

/**
 * Mixes `top` over `base` by `amount` (0 = base, 1 = top) in sRGB. Falls back
 * to `base` when either color is unparseable.
 */
export function mixColors(base: string, top: string, amount: number): string {
	const a = parseCssColor(base);
	const b = parseCssColor(top);
	if (!a) return base;
	if (!b) return rgbToHex(a);
	const t = clamp(amount, 0, 1);
	return rgbToHex({
		b: a.b + (b.b - a.b) * t,
		g: a.g + (b.g - a.g) * t,
		r: a.r + (b.r - a.r) * t,
	});
}
