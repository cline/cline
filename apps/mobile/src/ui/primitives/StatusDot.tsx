import { type StyleProp, View, type ViewStyle } from "react-native";
import { STATUS_DOT_COLOR, type StatusTone } from "../theme";

export { STATUS_DOT_COLOR, type StatusTone };

export interface StatusDotProps {
	/** Semantic tone; overridden by an explicit `color`. */
	tone?: StatusTone;
	color?: string;
	/** Diameter (px). Status dot = 8, sidebar marker = 6. */
	size?: number;
	style?: StyleProp<ViewStyle>;
}

/** Small round status marker. */
export function StatusDot({
	tone = "neutral",
	color,
	size = 8,
	style,
}: StatusDotProps) {
	return (
		<View
			style={[
				{
					width: size,
					height: size,
					borderRadius: size / 2,
					backgroundColor: color ?? STATUS_DOT_COLOR[tone],
				},
				style,
			]}
		/>
	);
}
