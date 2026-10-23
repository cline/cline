import { useEffect } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, {
	cancelAnimation,
	Easing,
	useAnimatedStyle,
	useReducedMotion,
	useSharedValue,
	withRepeat,
	withTiming,
} from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";
import { useTheme } from "../theme";

export interface SpinnerProps {
	/** Diameter in px. Tool progress = 12, approval = 14 (DESIGN_SPEC §4/§6). */
	size?: number;
	/** Ring stroke width. */
	thickness?: number;
	/** Accent color for the live edge; the track is this color @25%. */
	color?: string;
	/** Rotation period. Tool 800ms, approval 1000ms (DESIGN_SPEC §1). */
	durationMs?: number;
	style?: StyleProp<ViewStyle>;
}

/** Rounded circular arc on a muted track, static when motion is reduced. */
export function Spinner({
	size = 12,
	thickness = 2,
	color,
	durationMs = 800,
	style,
}: SpinnerProps) {
	const theme = useTheme();
	const accent = color ?? theme.brand.violet;
	const reduceMotion = useReducedMotion();
	const rotation = useSharedValue(0);
	const radius = (size - thickness) / 2;
	const circumference = 2 * Math.PI * radius;

	useEffect(() => {
		rotation.value = 0;
		if (reduceMotion) {
			return;
		}
		rotation.value = withRepeat(
			withTiming(360, { duration: durationMs, easing: Easing.linear }),
			-1,
		);
		return () => cancelAnimation(rotation);
	}, [reduceMotion, durationMs, rotation]);

	const animatedStyle = useAnimatedStyle(() => ({
		transform: [{ rotate: `${rotation.value}deg` }],
	}));

	return (
		<Animated.View
			accessibilityRole="progressbar"
			style={[
				{
					width: size,
					height: size,
				},
				animatedStyle,
				style,
			]}
		>
			<Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
				<Circle
					cx={size / 2}
					cy={size / 2}
					r={radius}
					fill="none"
					stroke={theme.brand.violetTrack}
					strokeWidth={thickness}
				/>
				<Circle
					cx={size / 2}
					cy={size / 2}
					r={radius}
					fill="none"
					stroke={accent}
					strokeWidth={thickness}
					strokeLinecap="round"
					strokeDasharray={[circumference / 4, (circumference * 3) / 4]}
					rotation={-90}
					origin={`${size / 2}, ${size / 2}`}
				/>
			</Svg>
		</Animated.View>
	);
}
