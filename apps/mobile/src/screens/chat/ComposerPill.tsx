/** Desktop-style flat composer controls with non-overlapping 44pt targets. */

import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import type { PolicyTone } from "@/screens/approval";
import { withAlpha } from "@/theme/brand";
import { Text, useTheme } from "@/ui";

export interface ComposerPillProps {
	/** Short glanceable text, e.g. `Auto: read+write`. */
	label: string;
	tone?: PolicyTone;
	leading?: ReactNode;
	trailing?: ReactNode;
	accessibilityLabel: string;
	accessibilityHint?: string;
	/** Omitted renders a static, non-interactive pill. */
	onPress?: () => void;
	/** Desktop uses an icon-only model trigger at phone widths. */
	compact?: boolean;
}

/** Fill / border / text for each tone, from the theme's feedback + brand families. */
export function usePillColors(tone: PolicyTone): {
	fill: string;
	border: string;
	text: string;
} {
	const theme = useTheme();
	switch (tone) {
		case "danger":
			return {
				fill: theme.feedback.danger.subtle,
				border: theme.feedback.danger.border,
				text: theme.feedback.danger.fg,
			};
		case "warning":
			return {
				fill: theme.feedback.warning.subtle,
				border: theme.feedback.warning.border,
				text: theme.feedback.warning.fg,
			};
		case "accent":
			return {
				fill: theme.brand.violetSubtle,
				border: theme.brand.violetBorder,
				text: theme.brand.violet,
			};
		default:
			return {
				fill: theme.color.surfaceMuted,
				border: theme.color.border,
				text: theme.color.textMuted,
			};
	}
}

export function ComposerPill({
	label,
	tone = "neutral",
	leading,
	trailing,
	accessibilityLabel,
	accessibilityHint,
	onPress,
	compact = false,
}: ComposerPillProps) {
	const colors = usePillColors(tone);
	const theme = useTheme();

	const shell = {
		flexDirection: "row" as const,
		alignItems: "center" as const,
		gap: 5,
		paddingHorizontal: compact ? 0 : 8,
		paddingVertical: 5,
		borderRadius: theme.radius.sm,
		minHeight: 44,
		minWidth: 44,
		justifyContent: "center" as const,
		backgroundColor: "transparent",
		maxWidth: 190,
	};

	const content = (
		<>
			{leading}
			{!compact ? (
				<Text
					variant="caption"
					weight="500"
					color={colors.text}
					numberOfLines={1}
					style={{ flexShrink: 1 }}
				>
					{label}
				</Text>
			) : null}
			{!compact ? trailing : null}
		</>
	);

	if (!onPress) {
		return (
			<View
				accessible
				accessibilityLabel={accessibilityLabel}
				style={shell}
				// A static pill still needs to be reachable by a screen reader.
				accessibilityRole="text"
			>
				{content}
			</View>
		);
	}

	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={accessibilityLabel}
			{...(accessibilityHint ? { accessibilityHint } : {})}
			onPress={onPress}
			style={({ pressed }) => [
				shell,
				pressed ? { backgroundColor: withAlpha(colors.text, 0.18) } : null,
				{ opacity: pressed ? 0.9 : 1 },
			]}
		>
			{content}
		</Pressable>
	);
}
