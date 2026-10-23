/**
 * oklch() -> hex conversion for the design-token pipeline.
 *
 * Pipeline: oklch (polar) -> OKLab (cartesian) -> LMS -> linear sRGB ->
 * sRGB transfer function -> clamp -> 8-bit hex. Matrices are Björn Ottosson's
 * published OKLab constants, matching the CSS Color 4 sample implementation.
 */

export interface Oklch {
	/** Perceptual lightness, 0..1. */
	readonly l: number;
	/** Chroma, unbounded but practically < 0.4. */
	readonly c: number;
	/** Hue angle in degrees. */
	readonly h: number;
	/** Alpha, 0..1. Defaults to 1 when the color has no alpha component. */
	readonly alpha: number;
}

const OKLCH_PATTERN = /^oklch\(\s*([^)]+)\)$/i;

/** `50%` -> 0.5, `0.5` -> 0.5, `none` -> 0. */
function parseComponent(raw: string): number | undefined {
	const text = raw.trim();
	if (text === "" || text.startsWith("var(")) return undefined;
	if (text === "none") return 0;
	const percent = text.endsWith("%");
	const value = Number.parseFloat(percent ? text.slice(0, -1) : text);
	if (!Number.isFinite(value)) return undefined;
	return percent ? value / 100 : value;
}

export function isOklch(value: string): boolean {
	return OKLCH_PATTERN.test(value.trim());
}

export function parseOklch(value: string): Oklch | undefined {
	const match = OKLCH_PATTERN.exec(value.trim());
	if (!match) return undefined;

	const [channelText, alphaText] = match[1].split("/");
	const channels = channelText
		.trim()
		.split(/[\s,]+/)
		.filter(Boolean);
	if (channels.length !== 3) return undefined;

	const l = parseComponent(channels[0]);
	const c = parseComponent(channels[1]);
	// Hue is an angle: a bare number is degrees, and `deg` is the only unit the
	// vendored sheet uses. Strip a unit suffix before parsing.
	const h = parseComponent(channels[2].replace(/deg$/i, ""));
	if (l === undefined || c === undefined || h === undefined) return undefined;

	let alpha = 1;
	if (alphaText !== undefined) {
		const parsed = parseComponent(alphaText);
		if (parsed === undefined) return undefined;
		alpha = parsed;
	}

	return { l, c, h, alpha };
}

/** OKLab -> linear sRGB. */
function oklabToLinearSrgb(
	l: number,
	a: number,
	b: number,
): [number, number, number] {
	const lCube = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const mCube = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const sCube = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;

	return [
		4.0767416621 * lCube - 3.3077115913 * mCube + 0.2309699292 * sCube,
		-1.2684380046 * lCube + 2.6097574011 * mCube - 0.3413193965 * sCube,
		-0.0041960863 * lCube - 0.7034186147 * mCube + 1.707614701 * sCube,
	];
}

/** Linear-light channel -> gamma-encoded sRGB, 0..1 (sign-preserving). */
function encodeSrgb(channel: number): number {
	const magnitude = Math.abs(channel);
	const encoded =
		magnitude <= 0.0031308
			? magnitude * 12.92
			: 1.055 * magnitude ** (1 / 2.4) - 0.055;
	return Math.sign(channel) * encoded;
}

function toByte(channel01: number): number {
	return Math.round(Math.min(1, Math.max(0, channel01)) * 255);
}

function hexByte(byte: number): string {
	return byte.toString(16).padStart(2, "0");
}

export function oklchToRgba(color: Oklch): [number, number, number, number] {
	const hueRadians = (color.h * Math.PI) / 180;
	const a = color.c * Math.cos(hueRadians);
	const b = color.c * Math.sin(hueRadians);
	const linear = oklabToLinearSrgb(color.l, a, b);
	return [
		toByte(encodeSrgb(linear[0])),
		toByte(encodeSrgb(linear[1])),
		toByte(encodeSrgb(linear[2])),
		toByte(color.alpha),
	];
}

/**
 * `oklch(0.75 0.12 165)` -> `#4dc19b`, `oklch(1 0 0 / 12%)` -> `#ffffff1f`.
 * Out-of-gamut colors are clamped per channel rather than gamut-mapped, which
 * matches what the CSS engines shipping these tokens already do.
 */
export function oklchToHex(value: string): string {
	const color = parseOklch(value);
	if (!color) {
		throw new Error(`Not a parseable oklch() color: ${JSON.stringify(value)}`);
	}
	const [r, g, b, a] = oklchToRgba(color);
	const rgb = `#${hexByte(r)}${hexByte(g)}${hexByte(b)}`;
	return a === 255 ? rgb : `${rgb}${hexByte(a)}`;
}
