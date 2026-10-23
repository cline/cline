/**
 * Port of sdk/packages/ui/components/agent-hero-heading.tsx.
 * The sentence uses a wrapping row so each gradient character can animate as a view.
 * Each lead word ends with a nonbreaking space to preserve font spacing without
 * creating a leading space after wrapping.
 */

import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useState } from "react";
import { type StyleProp, type TextStyle, View } from "react-native";
import Animated, {
	Easing,
	useAnimatedStyle,
	useReducedMotion,
	useSharedValue,
	withDelay,
	withTiming,
} from "react-native-reanimated";
import { Text } from "../primitives/Text";
import { useTheme } from "../theme";

export const HERO_VERBS = ["build", "create", "fix", "know"] as const;
export const HERO_CYCLE_MS = 2600;
export const HERO_STAGGER_MS = 45;
export const HERO_ENTER_MS = 500;
const HERO_ENTER_EASING = Easing.bezier(0.2, 0.65, 0.3, 1);
/**
 * CSS gradient angles run clockwise from the top, so 135 degrees runs
 * from the top left to the bottom right.
 */
const HERO_GRADIENT_START = { x: 0, y: 0 } as const;
const HERO_GRADIENT_END = { x: 1, y: 1 } as const;
export const HERO_GRADIENT_LOCATIONS = [0, 0.55, 1] as const;
const HERO_RISE_EM = 0.42;

/** The words before the verb, as their own wrap opportunities. */
const HERO_LEAD_WORDS = ["What", "would", "you", "like", "to"] as const;
/** U+00A0: a space the line breaker measures instead of trimming. */
const NBSP = " ";

/**
 * Keep the accessibility label fixed so the cycling verb is not announced.
 */
export const HERO_SENTENCE = `${HERO_LEAD_WORDS.join(" ")} ${HERO_VERBS[0]}?`;

export interface HeroHeadingProps {
	/** Extra type styling layered over the `hero` variant. */
	style?: StyleProp<TextStyle>;
}

export function HeroHeading({ style }: HeroHeadingProps) {
	const reduceMotion = useReducedMotion();
	const [verbIndex, setVerbIndex] = useState(0);

	// Reduced motion disables the cycling verb.
	useEffect(() => {
		if (reduceMotion) {
			return;
		}
		const interval = setInterval(() => {
			setVerbIndex((current) => (current + 1) % HERO_VERBS.length);
		}, HERO_CYCLE_MS);
		return () => clearInterval(interval);
	}, [reduceMotion]);

	const verb = HERO_VERBS[verbIndex] ?? HERO_VERBS[0];

	return (
		<View
			accessible
			accessibilityRole="header"
			accessibilityLabel={HERO_SENTENCE}
		>
			<View
				// The desktop marks the mutating content `aria-hidden` and lets the
				// heading's own label speak (agent-hero-heading.tsx:27).
				accessibilityElementsHidden
				importantForAccessibility="no-hide-descendants"
				style={{ flexDirection: "row", flexWrap: "wrap" }}
			>
				{HERO_LEAD_WORDS.map((word) => (
					<Text key={word} variant="hero" style={style}>
						{`${word}${NBSP}`}
					</Text>
				))}

				{/* Keyed on the verb so every character remounts as a unit and
				    restarts its animation, like the desktop's `key={verb}`. */}
				<View key={verb} style={{ flexDirection: "row" }}>
					{[...verb].map((character, index) => (
						<HeroVerbCharacter
							animate={!reduceMotion}
							character={character}
							delayMs={index * HERO_STAGGER_MS}
							// biome-ignore lint/suspicious/noArrayIndexKey: the keyed word remounts as a unit and character positions never reorder
							key={`${verb}-${index}`}
							style={style}
						/>
					))}
					{/* The "?" sits outside the gradient word, in `--foreground`. */}
					<Text variant="hero" style={style}>
						?
					</Text>
				</View>
			</View>
		</View>
	);
}

/**
 * One gradient-clipped character of the verb. Owns its own shared value so the
 * character count can change between verbs without changing the hook count of
 * any one component.
 *
 * The gradient is clipped PER CHARACTER, not across the word, because the CSS
 * `@supports` block hangs `background-image` on `…__character` (css:23) and sets
 * no `background-size`/`background-position` — so `background-size` stays `auto`
 * and each character's own box gets the whole periwinkle→violet→magenta ramp.
 * A single mask over the word would instead stretch one ramp across all the
 * characters, which is visibly different: per character every glyph carries the
 * full sweep, so the word reads as uniformly iridescent rather than as a
 * left-to-right colour progression. css:21 says the per-character split is
 * deliberate.
 *
 * The entrance is animated on a wrapper `Animated.View` OUTSIDE the MaskedView,
 * never on the mask or the masked child: animating a mask's own contents is the
 * RN sharp edge, whereas opacity/transform on an ancestor composites the already
 * masked layer. So the mask is laid out and rasterised once per verb and the
 * animation stays a UI-thread property change — no text re-measure, no mask
 * re-rasterisation mid-flight.
 */
function HeroVerbCharacter({
	animate,
	character,
	delayMs,
	style,
}: {
	animate: boolean;
	character: string;
	delayMs: number;
	style?: StyleProp<TextStyle>;
}) {
	const theme = useTheme();
	const metrics = theme.typography.hero;
	const rise = (metrics.fontSize ?? 32) * HERO_RISE_EM;
	// Reduced motion starts settled, so the verb is simply *there*.
	const enter = useSharedValue(animate ? 0 : 1);

	useEffect(() => {
		if (!animate) {
			enter.value = 1;
			return;
		}
		enter.value = withDelay(
			delayMs,
			withTiming(1, { duration: HERO_ENTER_MS, easing: HERO_ENTER_EASING }),
		);
	}, [animate, delayMs, enter]);

	const entering = useAnimatedStyle(() => ({
		opacity: enter.value,
		transform: [{ translateY: (1 - enter.value) * rise }],
	}));

	return (
		<Animated.View style={entering}>
			<MaskedView
				maskElement={
					// The mask reads alpha only; an opaque fill is all that matters.
					<Text style={[metrics, style]} variant="hero">
						{character}
					</Text>
				}
			>
				<LinearGradient
					colors={theme.brand.heroGradient}
					end={HERO_GRADIENT_END}
					locations={[...HERO_GRADIENT_LOCATIONS]}
					start={HERO_GRADIENT_START}
				>
					{/* An invisible copy gives the gradient the glyph's exact box, so
					    the ramp spans one character — `background-size: auto`. */}
					<Text
						style={[metrics, style, { color: "transparent" }]}
						variant="hero"
					>
						{character}
					</Text>
				</LinearGradient>
			</MaskedView>
		</Animated.View>
	);
}
