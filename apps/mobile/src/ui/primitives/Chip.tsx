import { X } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, type StyleProp, View, type ViewStyle } from "react-native";
import { useTheme } from "../theme";
import { Text } from "./Text";

export type ChipTone = "muted" | "accent" | "outline";
/** `sm` = desktop's meta pill (py 2). `md` = a comfortable touch target. */
export type ChipSize = "sm" | "md";

export interface ChipProps {
	label?: string;
	children?: ReactNode;
	tone?: ChipTone;
	size?: ChipSize;
	/** Leading element (icon or a StatusDot). */
	leading?: ReactNode;
	/** Full pill (999) vs `radius.sm` (6). Attachment chips are pills. */
	pill?: boolean;
	/** Shows an X remove button and wires `onRemove`. */
	onRemove?: () => void;
	/** Makes the chip tappable (suggestion chips). Adds a button role. */
	onPress?: () => void;
	/** Defaults to `label` when the chip is pressable. */
	accessibilityLabel?: string;
	/** Max label lines. Default 1 — chips are single-line by design. */
	numberOfLines?: number;
	style?: StyleProp<ViewStyle>;
}

const PADDING: Record<ChipSize, { horizontal: number; vertical: number }> = {
	sm: { horizontal: 8, vertical: 2 },
	md: { horizontal: 12, vertical: 8 },
};

/**
 * Small labelled pill — attachment chips, status pills, meta tags and tappable
 * suggestions. `muted` fills with `surfaceMuted`; `accent` uses the violet
 * subtle fill; `outline` is a bordered transparent chip.
 *
 * A pressable chip stays visually compact but takes `hitSlop` up to the 44pt
 * minimum touch target rather than growing the layout.
 */
export function Chip({
	label,
	children,
	tone = "muted",
	size = "sm",
	leading,
	pill = false,
	onRemove,
	onPress,
	accessibilityLabel,
	numberOfLines = 1,
	style,
}: ChipProps) {
	const theme = useTheme();

	const toneStyle: Record<ChipTone, ViewStyle> = {
		muted: { backgroundColor: theme.color.surfaceMuted },
		accent: { backgroundColor: theme.brand.violetSubtle },
		outline: { borderWidth: 1, borderColor: theme.color.border },
	};
	const textColor = tone === "accent" ? theme.brand.violet : theme.color.text;
	const padding = PADDING[size];

	const content = (
		<>
			{leading}
			{children ??
				(label ? (
					<Text
						variant="small"
						color={textColor}
						numberOfLines={numberOfLines}
						style={{ flexShrink: 1 }}
					>
						{label}
					</Text>
				) : null)}
			{onRemove ? (
				<Pressable
					accessibilityRole="button"
					accessibilityLabel="Remove"
					hitSlop={6}
					onPress={onRemove}
				>
					<X size={12} color={theme.color.textMuted} />
				</Pressable>
			) : null}
		</>
	);

	const shell: ViewStyle = {
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
		paddingHorizontal: padding.horizontal,
		paddingVertical: padding.vertical,
		borderRadius: pill ? 999 : theme.radius.sm,
	};

	if (onPress) {
		return (
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={accessibilityLabel ?? label}
				onPress={onPress}
				hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
				style={({ pressed }) => [
					shell,
					toneStyle[tone],
					{ opacity: pressed ? 0.7 : 1 },
					style,
				]}
			>
				{content}
			</Pressable>
		);
	}

	return <View style={[shell, toneStyle[tone], style]}>{content}</View>;
}
