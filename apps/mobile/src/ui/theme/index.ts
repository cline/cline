// Re-exported so a screen can name a hairline alpha without reaching for the
// whole theme (`<Divider alpha={borderAlpha.strong} />`).
export { borderAlpha, channel } from "@/theme/surfaces";
export {
	type FeedbackColors,
	type FeedbackTone,
	feedback,
	STATUS_DOT_COLOR,
	type StatusTone,
} from "./feedback";
export { fontAssets, useClineFonts } from "./fonts";
export { ThemeProvider, useTheme } from "./ThemeProvider";
export { darkTheme, lightTheme, type Theme } from "./theme";
export {
	fontFamily,
	fontWeight,
	type TextVariant,
	typography,
} from "./typography";
