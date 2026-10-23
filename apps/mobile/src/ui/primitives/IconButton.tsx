import type { ReactNode } from "react";
import {
	type GestureResponderEvent,
	Pressable,
	type PressableProps,
	type StyleProp,
	type ViewStyle,
} from "react-native";
import { useTheme } from "../theme";

export interface IconButtonProps {
	/** Icon element (e.g. `<Paperclip size={16} color={...} />`). */
	children: ReactNode;
	accessibilityLabel: string;
	onPress?: (event: GestureResponderEvent) => void;
	disabled?: boolean;
	/** Padding around the icon; the touch target is icon + 2×padding. */
	padding?: number;
	/** Fully round (send/scroll buttons) vs `radius.sm`. */
	round?: boolean;
	/** Optional solid background (e.g. white send button); default transparent. */
	background?: string;
	/** Pressed-state background (defaults to `surfaceMuted`). */
	pressedBackground?: string;
	/**
	 * Extends the touch target beyond the box. Use when `style` shrinks the
	 * button below the 44pt default (e.g. the 34px composer send pill).
	 */
	hitSlop?: PressableProps["hitSlop"];
	style?: StyleProp<ViewStyle>;
}

/**
 * Square (or round) pressable wrapping a single icon. Transparent by default
 * with a `surfaceMuted` pressed fill — the desktop hover treatment for message
 * actions, attach, etc. Provide `background` for filled buttons.
 */
export function IconButton({
	children,
	accessibilityLabel,
	onPress,
	disabled = false,
	padding = 6,
	round = false,
	background = "transparent",
	pressedBackground,
	hitSlop,
	style,
}: IconButtonProps) {
	const theme = useTheme();
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={accessibilityLabel}
			accessibilityState={{ disabled }}
			disabled={disabled}
			onPress={onPress}
			hitSlop={hitSlop}
			style={({ pressed }) => [
				{
					minWidth: 44,
					minHeight: 44,
					padding,
					alignItems: "center",
					justifyContent: "center",
					borderRadius: round ? 999 : theme.radius.sm,
					backgroundColor:
						pressed && !disabled
							? (pressedBackground ?? theme.color.surfaceMuted)
							: background,
					opacity: disabled ? 0.5 : 1,
				},
				style,
			]}
		>
			{children}
		</Pressable>
	);
}
