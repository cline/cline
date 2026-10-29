import { type StyleProp, View, type ViewStyle } from "react-native";
import { withAlpha } from "@/theme/brand";
import { useTheme } from "../theme";
import { Text } from "./Text";

export interface CommandLineProps {
	/** The exact command, verbatim. Rendered mono and selectable. */
	children: string;
	/**
	 * What a screen reader should say. Defaults to naming it as a command, since
	 * a bare "/handoff" read aloud is not obviously something to type.
	 */
	accessibilityLabel?: string;
	style?: StyleProp<ViewStyle>;
}

/**
 * One short command to run somewhere else — the `/handoff` instruction on the
 * intro screen. Desktop styles inline code as a `--card` chip in mono at 13px
 * with `.1em .35em` padding; this is that treatment sized up to a block so a
 * thumb can long-press it.
 *
 * Selectable text lets the user copy the command by long-pressing it.
 */
export function CommandLine({
	children,
	accessibilityLabel,
	style,
}: CommandLineProps) {
	const theme = useTheme();
	return (
		<View
			style={[
				{
					alignSelf: "flex-start",
					maxWidth: "100%",
					borderWidth: 1,
					borderColor: withAlpha(theme.color.border, theme.borderAlpha.medium),
					borderRadius: theme.radius.xs,
					backgroundColor: withAlpha(theme.color.canvas, 0.6),
					paddingHorizontal: 8,
					paddingVertical: 6,
				},
				style,
			]}
		>
			<Text
				variant="mono"
				selectable
				accessible
				accessibilityLabel={accessibilityLabel ?? `Command: ${children}`}
				style={{ fontSize: 13, lineHeight: 18 }}
			>
				{children}
			</Text>
		</View>
	);
}
