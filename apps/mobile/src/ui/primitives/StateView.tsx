import type { ReactNode } from "react";
import { type StyleProp, View, type ViewStyle } from "react-native";
import { IconBadge, type IconBadgeTone } from "./IconBadge";
import { Text } from "./Text";

export interface StateViewProps {
	/**
	 * Hero icon (a 24px lucide glyph). Wrapped in a tinted `IconBadge` medallion
	 * unless `bareIcon` is set — pass `bareIcon` for artwork that supplies its own
	 * presence, e.g. the Cline logo.
	 */
	icon?: ReactNode;
	bareIcon?: boolean;
	/** Medallion tone. `danger` for failures, `accent` for zero states. */
	tone?: IconBadgeTone;
	/** One short human sentence fragment — no punctuation-heavy error text. */
	headline: string;
	/** One line explaining what happened or what to do next. */
	body?: string;
	/** Action row — buttons, chips. Rendered under the copy. */
	children?: ReactNode;
	/**
	 * Demoted content pinned below the actions with extra separation: the
	 * technical `Details` disclosure, secondary hints.
	 */
	footer?: ReactNode;
	style?: StyleProp<ViewStyle>;
}

/**
 * The centered zero/error/loading scaffold: medallion → headline → one line of
 * body → actions → demoted footer, vertically centered in the remaining space
 * with the copy measure capped so it never runs edge to edge.
 *
 * Follows DESIGN_SPEC §3's empty-state geometry (centered column, 32px padding,
 * 12px gaps, centered text) scaled up for a full screen: the headline takes the
 * `lg 18/26` heading step so it out-ranks the `sm` body, and the icon uses the
 * §2 quick-action medallion treatment so error/empty states read as the same
 * product as Connect.
 */
export function StateView({
	icon,
	bareIcon = false,
	tone = "accent",
	headline,
	body,
	children,
	footer,
	style,
}: StateViewProps) {
	return (
		<View
			style={[
				{
					flexGrow: 1,
					alignItems: "center",
					justifyContent: "center",
					gap: 12,
					paddingHorizontal: 32,
					paddingVertical: 32,
					minHeight: 256,
				},
				style,
			]}
		>
			{icon ? (
				bareIcon ? (
					icon
				) : (
					<IconBadge tone={tone} size={56} radius={16} bordered>
						{icon}
					</IconBadge>
				)
			) : null}

			<View style={{ gap: 6, alignItems: "center", maxWidth: 320 }}>
				<Text variant="heading" style={{ textAlign: "center" }}>
					{headline}
				</Text>
				{body ? (
					<Text variant="body" tone="muted" style={{ textAlign: "center" }}>
						{body}
					</Text>
				) : null}
			</View>

			{children}

			{footer ? (
				<View style={{ marginTop: 12, alignSelf: "stretch", maxWidth: 360 }}>
					{footer}
				</View>
			) : null}
		</View>
	);
}
