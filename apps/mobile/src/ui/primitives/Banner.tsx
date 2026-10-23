import type { ReactNode } from "react";
import { useEffect } from "react";
import { Pressable, type StyleProp, View, type ViewStyle } from "react-native";
import Animated, {
	Easing,
	useAnimatedStyle,
	useReducedMotion,
	useSharedValue,
	withRepeat,
	withTiming,
} from "react-native-reanimated";
import type { FeedbackTone } from "../theme";
import { useTheme } from "../theme";
import { Text } from "./Text";

export interface BannerProps {
	/** Short, single-line message. Ignored when `children` is provided. */
	message?: string;
	children?: ReactNode;
	/** Semantic tone — picks the fill, hairline and text color. */
	tone?: FeedbackTone;
	/** Leading icon (16px lucide). Pulses gently when `pulse` is set. */
	leading?: ReactNode;
	/** Trailing element — a chevron, count, or small action. */
	trailing?: ReactNode;
	/**
	 * Breathing opacity on the leading slot plus a hairline progress rule, for
	 * "work in progress" banners (reconnecting). Disabled under reduced motion.
	 */
	pulse?: boolean;
	/** Makes the whole banner tappable (44pt min height) and adds a button role. */
	onPress?: () => void;
	accessibilityLabel?: string;
	style?: StyleProp<ViewStyle>;
}

/** Inline status banner with an optional action. */
export function Banner({
	message,
	children,
	tone = "neutral",
	leading,
	trailing,
	pulse = false,
	onPress,
	accessibilityLabel,
	style,
}: BannerProps) {
	const theme = useTheme();
	const palette = theme.feedback[tone];
	const reduceMotion = useReducedMotion();
	const breathe = useSharedValue(1);

	useEffect(() => {
		if (!pulse || reduceMotion) {
			return;
		}
		breathe.value = withRepeat(
			withTiming(0.35, { duration: 900, easing: Easing.inOut(Easing.ease) }),
			-1,
			true,
		);
	}, [pulse, reduceMotion, breathe]);

	const breatheStyle = useAnimatedStyle(() => ({ opacity: breathe.value }));

	const body = (
		<View
			style={[
				{
					flexDirection: "row",
					alignItems: "center",
					gap: 8,
					minHeight: onPress ? 44 : 32,
					paddingHorizontal: 16,
					paddingVertical: 8,
					backgroundColor: palette.subtle,
					borderBottomWidth: 1,
					borderBottomColor: palette.border,
				},
				style,
			]}
		>
			{leading ? (
				pulse ? (
					<Animated.View style={breatheStyle}>{leading}</Animated.View>
				) : (
					leading
				)
			) : null}
			<View style={{ flex: 1 }}>
				{children ??
					(message ? (
						<Text variant="small" color={palette.fg} numberOfLines={2}>
							{message}
						</Text>
					) : null)}
			</View>
			{trailing}
			{pulse ? (
				<Animated.View
					style={[
						{
							position: "absolute",
							left: 0,
							right: 0,
							bottom: 0,
							height: 1,
							backgroundColor: palette.fg,
						},
						breatheStyle,
					]}
				/>
			) : null}
		</View>
	);

	if (!onPress) {
		return body;
	}

	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={accessibilityLabel ?? message}
			onPress={onPress}
			style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
		>
			{body}
		</Pressable>
	);
}
