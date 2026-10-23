import type { ReactNode } from "react";
import { type StyleProp, View, type ViewStyle } from "react-native";
import type { FeedbackTone } from "../theme";
import { useTheme } from "../theme";

/** `accent` is the violet primary; the rest map to the feedback family. */
export type IconBadgeTone = "accent" | FeedbackTone;

export interface IconBadgeProps {
	children: ReactNode;
	tone?: IconBadgeTone;
	/** Square edge length. 28 = inline affordance, 36 = card, 56 = state hero. */
	size?: number;
	/** Corner radius. Defaults to `radius.md` (8); pass 999 for a medallion. */
	radius?: number;
	/** Adds a hairline ring in the tone's 40% border color. */
	bordered?: boolean;
	style?: StyleProp<ViewStyle>;
}

/**
 * A rounded, tinted square holding one icon — the affordance desktop uses for
 * the quick-action arrow (`brandViolet@10%` fill, DESIGN_SPEC §2) and the same
 * shape a centered state uses for its hero icon. Purely decorative: wrap it in
 * a `Pressable`/`IconButton` when it needs to be tappable.
 */
export function IconBadge({
	children,
	tone = "accent",
	size = 36,
	radius,
	bordered = false,
	style,
}: IconBadgeProps) {
	const theme = useTheme();
	const palette =
		tone === "accent"
			? { subtle: theme.brand.violetSubtle, border: theme.brand.violetBorder }
			: theme.feedback[tone];

	return (
		<View
			style={[
				{
					width: size,
					height: size,
					borderRadius: radius ?? theme.radius.md,
					backgroundColor: palette.subtle,
					borderWidth: bordered ? 1 : 0,
					borderColor: bordered ? palette.border : undefined,
					alignItems: "center",
					justifyContent: "center",
				},
				style,
			]}
		>
			{children}
		</View>
	);
}
