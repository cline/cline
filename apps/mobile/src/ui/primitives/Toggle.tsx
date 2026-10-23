/**
 * A themed switch.
 *
 * The kit has no Switch primitive and RN's `Switch` is a native component that
 * does not render under `react-test-renderer` in Node, so this is a `Pressable`
 * with `accessibilityRole="switch"` — the same semantics, painted with brand
 * tokens. Lifted out of `SettingsScreen` when the auto-approve tiers grew a
 * second surface (the composer sheet) so both flip identical-looking switches.
 */

import { Pressable, type StyleProp, View, type ViewStyle } from "react-native";
import { useTheme } from "../theme";

export interface ToggleProps {
	value: boolean;
	accessibilityLabel: string;
	/** Spoken after the label, for the risk of turning this on. */
	accessibilityHint?: string;
	disabled?: boolean;
	onChange(next: boolean): void;
	style?: StyleProp<ViewStyle>;
}

const TRACK_WIDTH = 44;
const TRACK_HEIGHT = 26;

export function Toggle({
	value,
	accessibilityLabel,
	accessibilityHint,
	disabled = false,
	onChange,
	style,
}: ToggleProps) {
	const theme = useTheme();
	return (
		<Pressable
			accessibilityRole="switch"
			accessibilityLabel={accessibilityLabel}
			{...(accessibilityHint ? { accessibilityHint } : {})}
			accessibilityState={{ checked: value, disabled }}
			disabled={disabled}
			onPress={() => onChange(!value)}
			// The 26px track keeps a settings list compact; hitSlop restores the 44pt
			// minimum touch target around it without growing the row.
			hitSlop={{ top: 9, bottom: 9, left: 8, right: 8 }}
			style={[
				{
					width: TRACK_WIDTH,
					height: TRACK_HEIGHT,
					borderRadius: TRACK_HEIGHT / 2,
					padding: 3,
					justifyContent: "center",
					alignItems: value ? "flex-end" : "flex-start",
					backgroundColor: value
						? theme.brand.violet
						: theme.color.surfaceMuted,
					borderWidth: 1,
					borderColor: value ? theme.brand.violetBorder : theme.color.border,
					opacity: disabled ? 0.5 : 1,
				},
				style,
			]}
		>
			<View
				style={{
					width: 20,
					height: 20,
					borderRadius: 10,
					backgroundColor: value ? theme.brand.onViolet : theme.color.textMuted,
				}}
			/>
		</Pressable>
	);
}
