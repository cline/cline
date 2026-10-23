import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect } from "react";
import { type StyleProp, StyleSheet, View, type ViewStyle } from "react-native";
import Animated, {
	Easing,
	useAnimatedStyle,
	useReducedMotion,
	useSharedValue,
	withRepeat,
	withTiming,
} from "react-native-reanimated";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { channel } from "@/theme/surfaces";
import { useTheme } from "../theme";

export interface AuroraBackgroundProps {
	/** Gentle breathing animation (gated on reduced motion). Default true. */
	animated?: boolean;
	style?: StyleProp<ViewStyle>;
}

/**
 * The signature violet aurora for the welcome surface (DESIGN_SPEC §8),
 * simplified for phone performance: two radial "blobs" (periwinkle bottom-left,
 * violet bottom-right) via `react-native-svg`, plus a horizon band
 * (lilac→magenta→periwinkle→cyan) via `expo-linear-gradient`, both edge-faded
 * with a vertical `MaskedView`. Desktop's per-band drift + 32 twinkling stars
 * are dropped in favor of a single slow opacity breathe (disabled under reduced
 * motion). Decorative and non-interactive (`pointerEvents="none"`).
 */
export function AuroraBackground({
	animated = true,
	style,
}: AuroraBackgroundProps) {
	const theme = useTheme();
	const { aurora, violet } = theme.brand;
	const reduceMotion = useReducedMotion();
	const breathe = useSharedValue(1);

	useEffect(() => {
		if (!animated || reduceMotion) {
			return;
		}
		breathe.value = withRepeat(
			withTiming(0.7, { duration: 6000, easing: Easing.inOut(Easing.ease) }),
			-1,
			true,
		);
	}, [animated, reduceMotion, breathe]);

	const blobStyle = useAnimatedStyle(() => ({ opacity: breathe.value }));

	return (
		<View
			pointerEvents="none"
			style={[StyleSheet.absoluteFill, { overflow: "hidden" }, style]}
		>
			{/* Radial blobs */}
			<Animated.View style={[StyleSheet.absoluteFill, blobStyle]}>
				<Svg style={StyleSheet.absoluteFill}>
					<Defs>
						<RadialGradient id="aurora-blob-a" cx="0.1" cy="1" r="0.9">
							<Stop
								offset="0"
								stopColor={aurora.periwinkle}
								stopOpacity={0.5}
							/>
							<Stop
								offset="0.7"
								stopColor={aurora.periwinkle}
								stopOpacity={0}
							/>
						</RadialGradient>
						<RadialGradient id="aurora-blob-b" cx="0.9" cy="1" r="0.9">
							<Stop offset="0" stopColor={violet} stopOpacity={0.55} />
							<Stop offset="0.7" stopColor={violet} stopOpacity={0} />
						</RadialGradient>
					</Defs>
					<Rect
						x="0"
						y="0"
						width="100%"
						height="100%"
						fill="url(#aurora-blob-a)"
					/>
					<Rect
						x="0"
						y="0"
						width="100%"
						height="100%"
						fill="url(#aurora-blob-b)"
					/>
				</Svg>
			</Animated.View>

			{/* Horizon band, bottom 45%, edge-faded top+bottom */}
			<View
				style={{
					position: "absolute",
					left: 0,
					right: 0,
					bottom: 0,
					height: "45%",
				}}
			>
				<MaskedView
					style={StyleSheet.absoluteFill}
					maskElement={
						<LinearGradient
							colors={[
								channel.maskClear,
								channel.maskOpaque,
								channel.maskOpaque,
								channel.maskClear,
							]}
							locations={[0, 0.32, 0.68, 1]}
							style={StyleSheet.absoluteFill}
						/>
					}
				>
					<LinearGradient
						colors={[
							aurora.lilac,
							aurora.magenta,
							aurora.periwinkle,
							aurora.cyan,
						]}
						start={{ x: 0, y: 0.5 }}
						end={{ x: 1, y: 0.5 }}
						style={[StyleSheet.absoluteFill, { opacity: 0.55 }]}
					/>
				</MaskedView>
			</View>
		</View>
	);
}
