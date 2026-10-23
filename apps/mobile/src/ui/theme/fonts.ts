import { useFonts } from "expo-font";
import { fontFamily } from "./typography";

/**
 * Font-asset map for `expo-font`. Both are VARIABLE ttf files fetched into
 * `apps/mobile/assets/fonts` (Google Fonts `SchibstedGrotesk[wght]` and
 * `AzeretMono[wght]`) — fontsource only ships woff2, which RN native can't load.
 * A single variable file per family covers every weight; `fontWeight` on a
 * `Text` selects the axis value at render time on the new architecture.
 */
export const fontAssets = {
	[fontFamily.sans]: require("../../../assets/fonts/SchibstedGrotesk.ttf"),
	[fontFamily.mono]: require("../../../assets/fonts/AzeretMono.ttf"),
} as const;

/**
 * Load the Cline fonts. Call once near the app root and hold rendering (or
 * show a splash) until `loaded` is true so text doesn't flash in a fallback.
 * Returns `[loaded, error]` from `expo-font`'s `useFonts`.
 */
export function useClineFonts(): readonly [boolean, Error | null] {
	return useFonts(fontAssets);
}
