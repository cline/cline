import { type StyleProp, View, type ViewStyle } from "react-native";
import { withAlpha } from "@/theme/brand";
import { useTheme } from "../theme";

export interface DividerProps {
	/** Vertical rule instead of horizontal. */
	vertical?: boolean;
	/** 0..1 fraction of the desktop border color (desktop softens dividers). */
	alpha?: number;
	style?: StyleProp<ViewStyle>;
}

/** Hairline rule in the `border` color (DESIGN_SPEC §1). */
export function Divider({ vertical = false, alpha, style }: DividerProps) {
	const theme = useTheme();
	const color =
		alpha != null ? withAlpha(theme.color.border, alpha) : theme.color.border;
	return (
		<View
			style={[
				vertical
					? { width: 1, alignSelf: "stretch" }
					: { height: 1, alignSelf: "stretch" },
				{ backgroundColor: color },
				style,
			]}
		/>
	);
}
