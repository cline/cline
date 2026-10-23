import { type Brand, brand, lightBrand } from "@/theme/brand";
import {
	borderAlpha,
	darkSurfaces,
	lightSurfaces,
	radii,
	type SurfaceColors,
	type SurfaceRadii,
} from "@/theme/surfaces";
import { darkTokens, lightTokens, type ThemeTokens } from "@/theme/tokens";
import {
	type FeedbackColors,
	type FeedbackTone,
	feedback,
	lightFeedback,
} from "./feedback";
import { typography } from "./typography";

/** Shared desktop surfaces with native typography and spacing. */
export interface Theme {
	readonly mode: "light" | "dark";
	/** Structural colors (canvas/surface/text/border/danger…) from surfaces.ts. */
	readonly color: SurfaceColors;
	/** Violet accent family (primary/emphasis/ring/aurora) from brand.ts. */
	readonly brand: Brand;
	/** Semantic feedback tones (amber/blue/red/green) from feedback.ts. */
	readonly feedback: Record<FeedbackTone, FeedbackColors>;
	readonly font: ThemeTokens["font"];
	readonly radius: SurfaceRadii;
	/** Hairline alphas desktop composes with, as fractions of the border color. */
	readonly borderAlpha: typeof borderAlpha;
	readonly shadow: ThemeTokens["shadow"];
	readonly duration: ThemeTokens["duration"];
	readonly ease: ThemeTokens["ease"];
	readonly typography: typeof typography;
	/** Tailwind-4 spacing: 1 unit = 4px (DESIGN_SPEC §1). */
	readonly space: (units: number) => number;
}

export const darkTheme: Theme = {
	mode: "dark",
	color: darkSurfaces,
	brand,
	feedback,
	font: darkTokens.font,
	radius: radii,
	borderAlpha,
	shadow: darkTokens.shadow,
	duration: darkTokens.duration,
	ease: darkTokens.ease,
	typography,
	space: (units) => units * 4,
};

export const lightTheme: Theme = {
	...darkTheme,
	mode: "light",
	color: lightSurfaces,
	brand: lightBrand,
	feedback: lightFeedback,
	shadow: lightTokens.shadow,
};
