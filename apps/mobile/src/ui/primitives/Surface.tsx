import type { ReactNode } from "react";
import { type StyleProp, View, type ViewStyle } from "react-native";
import { withAlpha } from "@/theme/brand";
import { channel } from "@/theme/surfaces";
import { useTheme } from "../theme";

export type SurfaceLevel =
	| "canvas"
	| "surface"
	| "raised"
	| "popover"
	| "muted";

export interface SurfaceProps {
	children?: ReactNode;
	/** Which structural fill to use. Cards/panels = `raised`. */
	level?: SurfaceLevel;
	/** Hairline border in `border` color. Card presence comes from this. */
	bordered?: boolean;
	/**
	 * Softens the desktop border color toward transparent (0..1). Omit for full.
	 */
	borderAlpha?: number;
	/** Corner radius (px). Defaults to `radius.md` (8). */
	radius?: number;
	/** Uniform padding (px). */
	padding?: number;
	/** Soft shadow (`shadow.raised`) for popovers/sheets. Cards stay flat. */
	elevated?: boolean;
	style?: StyleProp<ViewStyle>;
}

/**
 * Layered container primitive. Depth comes from the 1px border + fill, not heavy
 * elevation (desktop is near-flat). `Card` is the common raised+bordered preset.
 */
export function Surface({
	children,
	level = "raised",
	bordered = false,
	borderAlpha,
	radius,
	padding,
	elevated = false,
	style,
}: SurfaceProps) {
	const theme = useTheme();
	const fill: Record<SurfaceLevel, string> = {
		canvas: theme.color.canvas,
		surface: theme.color.surface,
		raised: theme.color.surfaceRaised,
		popover: theme.color.popover,
		muted: theme.color.surfaceMuted,
	};
	const borderColor =
		borderAlpha != null
			? withAlpha(theme.color.border, borderAlpha)
			: theme.color.border;

	return (
		<View
			style={[
				{
					backgroundColor: fill[level],
					borderRadius: radius ?? theme.radius.md,
					padding,
					borderWidth: bordered ? 1 : 0,
					borderColor: bordered ? borderColor : undefined,
				},
				elevated
					? {
							// approximation of shadow.raised for RN
							shadowColor: channel.shadow,
							shadowOffset: { width: 0, height: 8 },
							shadowOpacity: 0.3,
							shadowRadius: 16,
							elevation: 4,
						}
					: null,
				style,
			]}
		>
			{children}
		</View>
	);
}

/** Raised, bordered, padded container — the default panel treatment. */
export function Card({
	padding = 12,
	radius,
	...rest
}: Omit<SurfaceProps, "level" | "bordered">) {
	const theme = useTheme();
	return (
		<Surface
			level="raised"
			bordered
			padding={padding}
			radius={radius ?? theme.radius.lg}
			{...rest}
		/>
	);
}
