import {
	Text as RNText,
	type TextProps as RNTextProps,
	type StyleProp,
	type TextStyle,
	useWindowDimensions,
} from "react-native";
import type { TextVariant } from "../theme";
import { useTheme } from "../theme";

export type TextTone = "default" | "muted" | "accent" | "danger" | "onBrand";

export interface TextProps extends RNTextProps {
	/** Type-scale variant (DESIGN_SPEC §1). Defaults to `body` (sm 14/20). */
	variant?: TextVariant;
	/** Semantic color. `accent` = violet brand. Overridden by an explicit `color`. */
	tone?: TextTone;
	/** Literal color override (wins over `tone`). */
	color?: string;
	/** Convenience weight override on top of the variant's weight. */
	weight?: TextStyle["fontWeight"];
	style?: StyleProp<TextStyle>;
}

/**
 * Typographic primitive. Resolves a `variant` to the shared type scale and a
 * `tone` to a theme color, then lets `style` layer on top. Everything textual
 * in the kit should go through this so the fonts/weights stay consistent.
 */
export function Text({
	variant = "body",
	tone = "default",
	color,
	weight,
	style,
	...rest
}: TextProps) {
	const theme = useTheme();
	const { fontScale } = useWindowDimensions();

	const toneColor: string =
		color ??
		{
			default: theme.color.text,
			muted: theme.color.textMuted,
			accent: theme.brand.violet,
			danger: theme.color.danger,
			onBrand: theme.brand.onViolet,
		}[tone];

	return (
		<RNText
			key={fontScale}
			style={[
				theme.typography[variant],
				{ color: toneColor },
				weight ? { fontWeight: weight } : null,
				style,
			]}
			{...rest}
		/>
	);
}
