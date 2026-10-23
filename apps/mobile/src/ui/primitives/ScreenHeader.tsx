import type { ReactNode } from "react";
import { type StyleProp, View, type ViewStyle } from "react-native";
import { fontWeight, useTheme } from "../theme";
import { Text } from "./Text";

export interface ScreenHeaderProps {
	/** Screen title. Announced as a header. Omit for an actions-only bar. */
	title?: string;
	/** Leading slot — the back `IconButton`. */
	leading?: ReactNode;
	/** Trailing slot — the action icon cluster. */
	trailing?: ReactNode;
	/**
	 * Content below the title row inside the same seam — the search field on the
	 * session list. Sits above the hairline, so it reads as part of the header.
	 */
	below?: ReactNode;
	/** Drop the fill and the hairline (used over the aurora on the intro). */
	transparent?: boolean;
	style?: StyleProp<ViewStyle>;
}

/**
 * The top bar every screen shares.
 *
 * Desktop's chrome is a `--sidebar` panel one step above `--background` with a
 * `--sidebar-border` hairline under it, so content scrolls against a seam
 * instead of floating on the canvas. That is what this reproduces: `surface`
 * fill, 1px `border` bottom, and the title at the `xl` step (20/28, -0.005em) at
 * `--font-weight-medium` — desktop reserves semibold for hero and markdown
 * headings, and uses medium for every chrome title.
 *
 * The gutter is 16 with the trailing cluster pulled back 10, because
 * `IconButton` carries its own 44pt padding: without the negative margin the
 * icons sit visually inset from the title and the content below them.
 */
export function ScreenHeader({
	title,
	leading,
	trailing,
	below,
	transparent = false,
	style,
}: ScreenHeaderProps) {
	const theme = useTheme();
	return (
		<View
			style={[
				{
					paddingLeft: leading ? 6 : 16,
					paddingRight: 6,
					paddingBottom: below ? 10 : 6,
					gap: 10,
				},
				transparent
					? null
					: {
							backgroundColor: theme.color.surface,
							borderBottomWidth: 1,
							borderBottomColor: theme.color.border,
						},
				style,
			]}
		>
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					minHeight: 48,
				}}
			>
				{leading}
				{title ? (
					<Text
						variant="title"
						weight={fontWeight.medium}
						numberOfLines={1}
						accessibilityRole="header"
						style={{ flex: 1, marginLeft: leading ? 4 : 0 }}
					>
						{title}
					</Text>
				) : (
					<View style={{ flex: 1 }} />
				)}
				{trailing}
			</View>
			{below ? (
				<View style={{ paddingLeft: leading ? 10 : 0, paddingRight: 10 }}>
					{below}
				</View>
			) : null}
		</View>
	);
}
