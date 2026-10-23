import { Fragment, useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
	Easing,
	useAnimatedProps,
	useReducedMotion,
	useSharedValue,
	withTiming,
} from "react-native-reanimated";
import Svg, {
	Defs,
	G,
	Mask,
	Path,
	Pattern,
	RadialGradient,
	Rect,
	Stop,
} from "react-native-svg";

import { useTheme } from "../theme";

const GRID_PATH =
	"M0 0V220M40 0V220M80 0V220M120 0V220M160 0V220M200 0V220M240 0V220M280 0V220M320 0V220M360 0V220M400 0V220M0 0H400M0 40H400M0 80H400M0 120H400M0 160H400M0 200H400M0 0L220 220M400 0L180 220";
const GRID_TILE_PATH =
	"M0 0V400M40 0V400M80 0V400M120 0V400M160 0V400M200 0V400M240 0V400M280 0V400M320 0V400M360 0V400M400 0V400M0 0H400M0 40H400M0 80H400M0 120H400M0 160H400M0 200H400M0 240H400M0 280H400M0 320H400M0 360H400M0 400H400M0 0L400 400M400 0L0 400";

// These are the same bot-fill-mask.svg and bot-outline-mask.svg paths used by
// @cline/ui's AgentWelcomeHero. Keeping the geometry identical lets the native
// welcome surface follow desktop without taking a dependency on DOM/CSS code.
const BOT_FILL_PATH =
	"M118.894 28.2461C118.894 19.3941 111.59 12.1251 102.222 12.125C92.8539 12.125 85.5499 19.394 85.5499 28.2461C85.5499 30.3758 85.9304 33.1689 86.7003 36.542L88.3927 43.9531H49.1749C40.8046 43.9531 34.0189 50.7388 34.0187 59.1094V87.875L13.2052 112.156L34.0187 136.437V165.203C34.0187 173.574 40.8044 180.359 49.1749 180.359H155.269C163.639 180.359 170.425 173.574 170.425 165.203V136.437L191.236 112.156L170.425 87.875V59.1094C170.425 50.739 163.639 43.9533 155.269 43.9531H116.051L117.742 36.542C118.512 33.1689 118.894 30.3758 118.894 28.2461ZM131.012 28.8877C130.992 29.8428 130.928 30.8253 130.827 31.8281H155.269C170.336 31.8283 182.55 44.0428 182.55 59.1094V83.3906L202.345 106.485C205.141 109.749 205.142 114.564 202.345 117.828L182.55 140.921V165.203C182.55 180.27 170.336 192.484 155.269 192.484H49.1749C34.1079 192.484 21.8937 180.27 21.8937 165.203V140.923L2.09777 117.828C-0.699604 114.564 -0.69891 109.749 2.09777 106.485L21.8937 83.3896V59.1094C21.8939 44.0427 34.1079 31.8281 49.1749 31.8281H73.6163C73.5159 30.8253 73.4516 29.8428 73.4318 28.8877L73.4249 28.2461C73.4249 12.3814 86.478 0 102.222 0C117.965 0.00014284 131.019 12.3814 131.019 28.2461L131.012 28.8877Z";

const BOT_OUTLINE_PATH =
	"M102.222 11.625C92.5893 11.6251 85.0497 19.1063 85.0497 28.2461L85.0546 28.6631C85.1002 30.7847 85.4871 33.4739 86.2128 36.6533L87.7655 43.4531H49.1747C40.5283 43.4532 33.5187 50.4628 33.5185 59.1094V87.6895L12.8251 111.831L12.5468 112.156L12.8251 112.481L33.5185 136.621V165.203C33.5185 173.85 40.528 180.859 49.1747 180.859H155.269C163.915 180.859 170.925 173.85 170.925 165.203V136.621L191.616 112.481L191.895 112.156L191.616 111.831L170.925 87.6895V59.1094L170.92 58.7051C170.705 50.2454 163.78 43.4533 155.269 43.4531H116.678L118.229 36.6533C119.004 33.262 119.394 30.4282 119.394 28.2461L119.388 27.8193C119.157 18.8746 111.704 11.6251 102.222 11.625ZM22.3935 140.738L22.2733 140.598L2.47742 117.503C-0.159452 114.426 -0.158827 109.887 2.47742 106.811L22.2733 83.7148L22.3935 83.5742V59.1094C22.3937 44.3189 34.3839 32.3282 49.1747 32.3281H74.1688L74.1142 31.7783C74.0148 30.7865 73.9511 29.817 73.9315 28.877L73.9247 28.2461C73.9247 12.6714 86.7399 0.50006 102.222 0.5C117.703 0.50014 130.519 12.6714 130.519 28.2461L130.512 28.877C130.492 29.817 130.429 30.7865 130.33 31.7783L130.274 32.3281H155.269C170.059 32.3283 182.05 44.3189 182.05 59.1094V83.5752L182.17 83.7158L201.965 106.811C204.601 109.887 204.602 114.426 201.965 117.503L182.17 140.596L182.05 140.736V165.203C182.05 179.994 170.059 191.984 155.269 191.984H49.1747C34.3839 191.984 22.3935 179.994 22.3935 165.203V140.738Z";

const BOT_INNER_PATH =
	"M22.3935 140.738L22.2733 140.598L2.47742 117.503C-0.159452 114.426 -0.158827 109.887 2.47742 106.811L22.2733 83.7148L22.3935 83.5742V59.1094C22.3937 44.3189 34.3839 32.3282 49.1747 32.3281H74.1688L74.1142 31.7783C74.0148 30.7865 73.9511 29.817 73.9315 28.877L73.9247 28.2461C73.9247 12.6714 86.7399 0.50006 102.222 0.5C117.703 0.50014 130.519 12.6714 130.519 28.2461L130.512 28.877C130.492 29.817 130.429 30.7865 130.33 31.7783L130.274 32.3281H155.269C170.059 32.3283 182.05 44.3189 182.05 59.1094V83.5752L182.17 83.7158L201.965 106.811C204.601 109.887 204.602 114.426 201.965 117.503L182.17 140.596L182.05 140.736V165.203C182.05 179.994 170.059 191.984 155.269 191.984H49.1747C34.3839 191.984 22.3935 179.994 22.3935 165.203V140.738Z";
const AnimatedG = Animated.createAnimatedComponent(G);

export interface AgentWelcomeHeroProps {
	height?: number;
	/** Bounded SVG-space eye translation, driven by a touch on the welcome screen. */
	eyeOffset?: { x: number; y: number };
	/** Same composition variants exposed by Desktop's shared welcome hero. */
	variant?: "full" | "bot-only" | "grid-only";
	/** Desktop's full-viewport grid layout, used behind onboarding content. */
	layout?: "default" | "full-bleed";
}

/** Native counterpart of @cline/ui's current desktop AgentWelcomeHero. */
export function AgentWelcomeHero({
	height,
	eyeOffset = { x: 0, y: 0 },
	variant = "full",
	layout = "default",
}: AgentWelcomeHeroProps) {
	const theme = useTheme();
	const heroColor = theme.mode === "dark" ? "#d9ceff" : "#9b8bce";
	const gridColor = theme.mode === "dark" ? "#dbd9ff" : "#a19bb6";
	const reduceMotion = useReducedMotion();
	const eyeX = useSharedValue(0);
	const eyeY = useSharedValue(0);
	const mounted = useRef(false);
	useEffect(() => {
		if (!mounted.current) {
			mounted.current = true;
			eyeX.value = 0;
			eyeY.value = 0;
			return;
		}
		const animation = {
			duration: reduceMotion ? 0 : 140,
			easing: Easing.out(Easing.cubic),
		};
		eyeX.value = withTiming(reduceMotion ? 0 : eyeOffset.x, animation);
		eyeY.value = withTiming(reduceMotion ? 0 : eyeOffset.y, animation);
	}, [eyeOffset.x, eyeOffset.y, eyeX, eyeY, reduceMotion]);
	const animatedEyeProps = useAnimatedProps(() => ({
		transform: `translate(${eyeX.value} ${eyeY.value})`,
	}));
	return (
		<View
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			pointerEvents="none"
			style={
				layout === "full-bleed"
					? styles.fullBleed
					: [styles.container, height === undefined ? undefined : { height }]
			}
			testID="agent-welcome-hero"
		>
			<Svg
				height="100%"
				preserveAspectRatio="xMidYMid meet"
				viewBox={layout === "full-bleed" ? undefined : "0 0 400 220"}
				width="100%"
			>
				<Defs>
					<RadialGradient
						id="welcome-grid-fade"
						cx={layout === "full-bleed" ? "50%" : "200"}
						cy={layout === "full-bleed" ? "50%" : "105"}
						gradientUnits={
							layout === "full-bleed" ? "objectBoundingBox" : "userSpaceOnUse"
						}
						r={layout === "full-bleed" ? "58%" : "190"}
					>
						<Stop offset="0" stopColor={gridColor} stopOpacity={0.2} />
						<Stop offset="1" stopColor={gridColor} stopOpacity={0} />
					</RadialGradient>
					{layout === "full-bleed" ? (
						<>
							<Pattern
								id="welcome-grid-pattern"
								width={400}
								height={400}
								patternUnits="userSpaceOnUse"
							>
								<Path
									d={GRID_TILE_PATH}
									fill="none"
									stroke={gridColor}
									strokeWidth={0.6}
								/>
							</Pattern>
							<Mask id="welcome-grid-mask">
								<Rect
									width="100%"
									height="100%"
									fill="url(#welcome-grid-fade)"
								/>
							</Mask>
						</>
					) : null}
				</Defs>

				{variant !== "bot-only" ? (
					layout === "full-bleed" ? (
						<Rect
							width="100%"
							height="100%"
							fill="url(#welcome-grid-pattern)"
							mask="url(#welcome-grid-mask)"
							testID="agent-welcome-grid"
						/>
					) : (
						<Path
							d={GRID_PATH}
							fill="none"
							stroke="url(#welcome-grid-fade)"
							strokeWidth={0.6}
							testID="agent-welcome-grid"
						/>
					)
				) : null}
				{variant !== "grid-only" ? (
					<Fragment>
						<G transform="translate(97.5 -2)">
							<Path
								d={BOT_INNER_PATH}
								fill={heroColor}
								fillOpacity={theme.mode === "dark" ? 0.06 : 0.02}
								stroke={heroColor}
								strokeOpacity={theme.mode === "dark" ? 0.06 : 0.02}
								strokeWidth={1}
								testID="agent-welcome-bot-inner"
							/>
							<Path
								d={BOT_FILL_PATH}
								fill={heroColor}
								fillOpacity={0.13}
								testID="agent-welcome-bot-fill"
							/>
							<Path
								d={BOT_OUTLINE_PATH}
								fill="none"
								stroke={heroColor}
								strokeOpacity={0.12}
								strokeWidth={1}
								testID="agent-welcome-bot-outline"
							/>
						</G>
						<AnimatedG animatedProps={animatedEyeProps}>
							<Rect
								x={163}
								y={81}
								width={18}
								height={52}
								rx={9}
								fill={heroColor}
								fillOpacity={0.13}
								stroke={heroColor}
								strokeOpacity={0.12}
							/>
							<Rect
								x={219.5}
								y={81}
								width={18}
								height={52}
								rx={9}
								fill={heroColor}
								fillOpacity={0.13}
								stroke={heroColor}
								strokeOpacity={0.12}
							/>
						</AnimatedG>
					</Fragment>
				) : null}
			</Svg>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		height: 220,
		width: "100%",
	},
	fullBleed: {
		height: "100%",
		width: "100%",
	},
});
