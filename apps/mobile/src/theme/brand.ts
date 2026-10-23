/**
 * Native Cline brand artwork and semantic action colors.
 * Desktop keeps --brand-violet for artwork but uses --accent-9 for --primary.
 * These are intentionally distinct; primary buttons use primary/onPrimary.
 */

/**
 * Parse a color to an `rgba(...)` string at the given alpha. Accepts
 * `#rgb`, `#rrggbb`, `#rrggbbaa` and passes `rgb()/rgba()` through with the
 * alpha overridden. Used to reproduce desktop's `color-mix(... % transparent)`
 * alpha blends (e.g. `border@60%`, `violet@10%`) as precomputed RN colors.
 */
export function withAlpha(color: string, alpha: number): string {
	const a = Math.max(0, Math.min(1, alpha));
	if (color.startsWith("#")) {
		let hex = color.slice(1);
		if (hex.length === 3) {
			hex = hex
				.split("")
				.map((c) => c + c)
				.join("");
		}
		// Ignore any embedded alpha byte; caller-supplied alpha wins.
		const r = Number.parseInt(hex.slice(0, 2), 16);
		const g = Number.parseInt(hex.slice(2, 4), 16);
		const b = Number.parseInt(hex.slice(4, 6), 16);
		return `rgba(${r}, ${g}, ${b}, ${a})`;
	}
	const nums = color.match(/[\d.]+/g);
	if (nums && nums.length >= 3) {
		const [r, g, b] = nums;
		return `rgba(${r}, ${g}, ${b}, ${a})`;
	}
	return color;
}

/** `--brand-violet` artwork accent; separate from the primary button fill. */
const VIOLET = "#a486fd";
/** Brighter artwork gradient stop. */
const VIOLET_EMPHASIS = "#b8a0ff";

export interface Brand {
	readonly primary: string;
	readonly primaryEmphasis: string;
	readonly onPrimary: string;
	/** Artwork and inline accent. Primary buttons use `primary`. */
	readonly violet: string;
	/** Brighter artwork accent. */
	readonly violetEmphasis: string;
	/** Pressed/hover mid-tone between violet and emphasis. */
	readonly violetHover: string;
	/** Text/icon color on the bright artwork violet; buttons use `onPrimary`. */
	readonly onViolet: string;
	/** Focus ring color (`--ring`) — violet, NOT the green `focus` token. */
	readonly ring: string;
	/** violet @10% — arrow-affordance fill, subtle accent chips. */
	readonly violetSubtle: string;
	/** violet @20% — focus glow ring. */
	readonly violetRing: string;
	/** violet @25% — spinner track. */
	readonly violetTrack: string;
	/** violet @50% — focused input border. */
	readonly violetBorder: string;
	/** Aurora / hero artwork family (raw, saturated — for artwork fills). */
	readonly aurora: {
		readonly lilac: string;
		readonly magenta: string;
		readonly periwinkle: string;
		readonly cyan: string;
	};
	/**
	 * On-dark legible variants of the aurora family — lightened so they read as
	 * text/label/icon color on the dark canvas (raw aurora tones are too dark).
	 */
	readonly auroraOnDark: {
		readonly lilac: string;
		readonly magenta: string;
		readonly periwinkle: string;
		readonly cyan: string;
	};
	/** Stops for the hero gradient text: periwinkle → violet (55%) → magenta. */
	readonly heroGradient: readonly [string, string, string];
	/** Stops for the welcome send-button gradient: emphasis → violet (145deg). */
	readonly sendGradient: readonly [string, string];
}

/** `--brand-magenta` `oklch(0.64 0.17 330)` — the hero gradient's warm end. */
const MAGENTA = "#c360bc";
/** `--brand-periwinkle` `oklch(0.63 0.16 275)` — the hero gradient's cool end. */
const PERIWINKLE = "#6f7de8";

export const brand: Brand = {
	primary: "#6e56cf",
	primaryEmphasis: "#7d66d9",
	onPrimary: "#ffffff",
	violet: VIOLET,
	violetEmphasis: VIOLET_EMPHASIS,
	// Midpoint of the artwork violet and its emphasis: oklch(0.735 0.16 293).
	violetHover: "#ae93ff",
	// Dark foreground for the bright artwork violet.
	onViolet: "#0c0c14",
	// --ring / --accent-8
	ring: "#6958ad",
	violetSubtle: withAlpha(VIOLET, 0.1),
	violetRing: withAlpha(VIOLET, 0.2),
	violetTrack: withAlpha(VIOLET, 0.25),
	violetBorder: withAlpha(VIOLET, 0.5),
	aurora: {
		// --brand-lilac oklch(0.68 0.13 315)
		lilac: "#b67ecf",
		magenta: MAGENTA,
		periwinkle: PERIWINKLE,
		// --brand-cyan oklch(0.72 0.09 210)
		cyan: "#58b4c4",
	},
	// The same hues at oklch L ≈ 0.76-0.84, so they read as text on the canvas.
	auroraOnDark: {
		lilac: "#dda4f7",
		magenta: "#ec86e4",
		periwinkle: "#91a3ff",
		cyan: "#80dbeb",
	},
	heroGradient: [PERIWINKLE, VIOLET, MAGENTA],
	sendGradient: ["#7d66d9", "#6e56cf"],
};

const LIGHT_VIOLET = "#6550b9";
export const lightBrand: Brand = {
	...brand,
	primaryEmphasis: "#654dc4",
	violet: LIGHT_VIOLET,
	violetEmphasis: "#2f265f",
	violetHover: "#654dc4",
	onViolet: "#ffffff",
	ring: "#aa99ec",
	violetSubtle: withAlpha(LIGHT_VIOLET, 0.1),
	violetRing: withAlpha(LIGHT_VIOLET, 0.2),
	violetTrack: withAlpha(LIGHT_VIOLET, 0.25),
	violetBorder: withAlpha(LIGHT_VIOLET, 0.5),
	auroraOnDark: {
		lilac: "#80539a",
		magenta: "#9c398f",
		periwinkle: "#5359ac",
		cyan: "#217582",
	},
	heroGradient: ["#5359ac", LIGHT_VIOLET, "#9c398f"],
	sendGradient: ["#654dc4", "#6e56cf"],
};
