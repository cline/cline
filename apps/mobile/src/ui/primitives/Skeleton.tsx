import { useEffect } from "react";
import type { DimensionValue, StyleProp, ViewStyle } from "react-native";
import Animated, {
	Easing,
	useAnimatedStyle,
	useReducedMotion,
	useSharedValue,
	withRepeat,
	withTiming,
} from "react-native-reanimated";
import { useTheme } from "../theme";

export interface SkeletonProps {
	width?: DimensionValue;
	/** Block height. A text line is 12–14. */
	height?: number;
	/** Corner radius. Defaults to `radius.sm` (6); pass 999 for a pill. */
	radius?: number;
	/** Stagger the pulse so stacked lines don't breathe in lockstep (ms). */
	delayMs?: number;
	style?: StyleProp<ViewStyle>;
}

/**
 * Placeholder block for content that has not hydrated yet. Fills with
 * `surfaceMuted` and breathes its opacity on a slow loop — desktop's shimmer
 * sweep (DESIGN_SPEC §4 streaming title) reduced to the cheap substitute the RN
 * notes sanction, since a masked gradient per skeleton line is not worth the
 * frame budget on a phone. Static under reduced motion.
 */
export function Skeleton({
	width = "100%",
	height = 12,
	radius,
	delayMs = 0,
	style,
}: SkeletonProps) {
	const theme = useTheme();
	const reduceMotion = useReducedMotion();
	const pulse = useSharedValue(0.9);

	useEffect(() => {
		if (reduceMotion) {
			return;
		}
		// A different period per line reads as an organic stagger without needing
		// a delay primitive (`withDelay` would idle the first cycle instead).
		pulse.value = withRepeat(
			withTiming(0.4, {
				duration: 1100 + delayMs,
				easing: Easing.inOut(Easing.ease),
			}),
			-1,
			true,
		);
	}, [reduceMotion, delayMs, pulse]);

	const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

	return (
		<Animated.View
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			style={[
				{
					width,
					height,
					borderRadius: radius ?? theme.radius.sm,
					backgroundColor: theme.color.surfaceMuted,
				},
				pulseStyle,
				style,
			]}
		/>
	);
}
