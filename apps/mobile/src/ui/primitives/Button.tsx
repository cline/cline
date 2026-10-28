import type { ReactNode } from "react";
import {
	type GestureResponderEvent,
	Pressable,
	type StyleProp,
	type ViewStyle,
} from "react-native";
import { useTheme } from "../theme";
import { Spinner } from "./Spinner";
import { Text } from "./Text";

export type ButtonVariant =
	| "primary"
	| "secondary"
	| "outline"
	| "ghost"
	| "destructive";
export type ButtonSize = "sm" | "default";

export interface ButtonProps {
	label?: string;
	/** Custom content (overrides `label`). */
	children?: ReactNode;
	variant?: ButtonVariant;
	size?: ButtonSize;
	disabled?: boolean;
	/** Shows a spinner + optional `loadingLabel`, and blocks interaction. */
	loading?: boolean;
	loadingLabel?: string;
	/** Leading icon element (e.g. a lucide icon). */
	icon?: ReactNode;
	fullWidth?: boolean;
	onPress?: (event: GestureResponderEvent) => void;
	accessibilityLabel?: string;
	style?: StyleProp<ViewStyle>;
}

interface VariantColors {
	bg: string;
	bgPressed: string;
	border?: string;
	fg: string;
}

/** Native controls keep a 44pt touch target even when their label is compact. */
const HEIGHT: Record<ButtonSize, number> = { sm: 44, default: 44 };

/**
 * Primary action button. Violet-filled `primary` is the desktop `--primary`
 * accent; `secondary`/`outline`/`ghost`/`destructive` cover the rest of the
 * desktop button vocabulary. Pressed/disabled/loading states per DESIGN_SPEC.
 */
export function Button({
	label,
	children,
	variant = "primary",
	size = "default",
	disabled = false,
	loading = false,
	loadingLabel,
	icon,
	fullWidth = false,
	onPress,
	accessibilityLabel,
	style,
}: ButtonProps) {
	const theme = useTheme();
	const { brand, color } = theme;

	const palette: Record<ButtonVariant, VariantColors> = {
		primary: {
			bg: brand.primary,
			bgPressed: brand.primaryEmphasis,
			fg: brand.onPrimary,
		},
		secondary: {
			bg: color.surfaceMuted,
			bgPressed: color.surface,
			fg: color.text,
		},
		outline: {
			bg: "transparent",
			bgPressed: color.surfaceMuted,
			border: color.border,
			fg: color.text,
		},
		ghost: {
			bg: "transparent",
			bgPressed: color.surfaceMuted,
			fg: color.textMuted,
		},
		destructive: {
			bg: color.danger,
			bgPressed: color.danger,
			fg: color.onDanger,
		},
	};

	const v = palette[variant];
	const isInteractive = !disabled && !loading;
	const displayLabel = loading && loadingLabel ? loadingLabel : label;

	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={accessibilityLabel ?? label}
			accessibilityState={{ disabled: !isInteractive, busy: loading }}
			disabled={!isInteractive}
			onPress={onPress}
			style={({ pressed }) => [
				{
					minHeight: HEIGHT[size],
					paddingVertical: 10,
					flexDirection: "row",
					alignItems: "center",
					justifyContent: "center",
					gap: 6,
					paddingHorizontal: 12,
					borderRadius: theme.radius.sm,
					backgroundColor: pressed && isInteractive ? v.bgPressed : v.bg,
					borderWidth: v.border ? 1 : 0,
					borderColor: v.border,
					opacity: disabled ? 0.5 : 1,
					alignSelf: fullWidth ? "stretch" : "flex-start",
				},
				style,
			]}
		>
			{loading ? <Spinner size={14} color={v.fg} durationMs={1000} /> : icon}
			{children ??
				(displayLabel ? (
					<Text
						variant="body"
						weight="500"
						color={v.fg}
						style={{ flexShrink: 1, textAlign: "center" }}
					>
						{displayLabel}
					</Text>
				) : null)}
		</Pressable>
	);
}
