import { ChevronDown } from "lucide-react-native";
import { type ReactNode, useEffect, useState } from "react";
import { Pressable, type StyleProp, View, type ViewStyle } from "react-native";
import Animated, {
	Easing,
	useAnimatedStyle,
	useReducedMotion,
	useSharedValue,
	withTiming,
} from "react-native-reanimated";
import { useTheme } from "../theme";
import { Text } from "./Text";

/**
 * `rail` = desktop's `EXPANDED_PANEL_RAIL_CLASS`: no box, just a left hairline
 * (DESIGN_SPEC §4 reasoning block). `inset` = content indented under the label,
 * past the icon (§4 tool card, `paddingLeft 32`).
 */
export type DisclosureVariant = "rail" | "inset";

export interface DisclosureProps {
	/** Trigger label. */
	label: string;
	children?: ReactNode;
	/** Leading icon (16px lucide) shown before the label. */
	leading?: ReactNode;
	/** Sits between the label and the chevron — e.g. `+N −N` diff counts. */
	trailing?: ReactNode;
	/** Explicit label color (tool cards color the whole trigger by state). */
	labelColor?: string;
	variant?: DisclosureVariant;
	/** `inset` content indent. Default 32 — aligns under the trigger label. */
	indent?: number;
	/** Start expanded (uncontrolled). */
	defaultExpanded?: boolean;
	/** Controlled expansion; pair with `onToggle`. */
	expanded?: boolean;
	onToggle?: (expanded: boolean) => void;
	/**
	 * Base label for assistive tech. The expand/collapse hint is appended, so
	 * pass the *subject* ("Reasoning", "Error details"), not an instruction.
	 */
	accessibilityLabel?: string;
	/** Max label lines before ellipsizing. Default 2. */
	numberOfLines?: number;
	/** Tool rows on desktop omit the disclosure glyph; reasoning keeps it. */
	showIndicator?: boolean;
	style?: StyleProp<ViewStyle>;
}

/**
 * Collapsible section with a 28px-min trigger row and a `ChevronDown` that
 * rotates 180° when open (DESIGN_SPEC §4; rotation is instant under reduced
 * motion). The reasoning block, tool-activity card and the error state's
 * technical "Details" all share this so the disclosure affordance — and its
 * accessibility contract — is written once.
 */
export function Disclosure({
	label,
	children,
	leading,
	trailing,
	labelColor,
	variant = "inset",
	indent = 32,
	defaultExpanded = false,
	expanded: controlledExpanded,
	onToggle,
	accessibilityLabel,
	numberOfLines = 2,
	showIndicator = true,
	style,
}: DisclosureProps) {
	const theme = useTheme();
	const [uncontrolled, setUncontrolled] = useState(defaultExpanded);
	const expanded = controlledExpanded ?? uncontrolled;
	const reduceMotion = useReducedMotion();
	const rotation = useSharedValue(expanded ? 180 : 0);

	useEffect(() => {
		const target = expanded ? 180 : 0;
		rotation.value = reduceMotion
			? target
			: withTiming(target, {
					duration: 180,
					easing: Easing.bezier(0.2, 0, 0, 1),
				});
	}, [expanded, reduceMotion, rotation]);

	const chevronStyle = useAnimatedStyle(() => ({
		transform: [{ rotate: `${rotation.value}deg` }],
	}));

	const toggle = () => {
		const next = !expanded;
		if (controlledExpanded === undefined) {
			setUncontrolled(next);
		}
		onToggle?.(next);
	};

	return (
		<View style={style}>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={`${accessibilityLabel ?? label}, ${
					expanded ? "collapse" : "expand"
				}`}
				accessibilityState={{ expanded }}
				// The row itself is 28px like desktop; hitSlop lifts the touch target
				// to the 44pt minimum without inflating the layout.
				hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
				onPress={toggle}
				style={({ pressed }) => ({
					flexDirection: "row",
					alignItems: "center",
					gap: 8,
					minHeight: 28,
					opacity: pressed ? 0.7 : 1,
				})}
			>
				{leading}
				<Text
					variant="body"
					weight="500"
					color={labelColor ?? theme.color.text}
					numberOfLines={numberOfLines}
					style={{ flex: 1 }}
				>
					{label}
				</Text>
				{trailing}
				{showIndicator ? (
					<Animated.View style={chevronStyle}>
						<ChevronDown
							size={16}
							color={labelColor ?? theme.color.textMuted}
						/>
					</Animated.View>
				) : null}
			</Pressable>
			{expanded && children ? (
				<View
					style={
						variant === "rail"
							? {
									marginTop: 4,
									marginLeft: 4,
									paddingLeft: 8,
									paddingVertical: 4,
									borderLeftWidth: 1,
									borderLeftColor: theme.color.border,
								}
							: { marginTop: 6, paddingLeft: indent }
					}
				>
					{children}
				</View>
			) : null}
		</View>
	);
}
