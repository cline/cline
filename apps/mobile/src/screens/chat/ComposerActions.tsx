import { LinearGradient } from "expo-linear-gradient";
import { ArrowUp, CircleStop } from "lucide-react-native";
import type { ReactNode } from "react";
import { View } from "react-native";
import { withAlpha } from "@/theme/brand";
import { IconButton, useTheme } from "@/ui";

/** Desktop's message actions, with separate 44pt touch targets on mobile. */
export function ComposerActions({
	canSend,
	onSend,
	sendLabel,
	onAbort,
	welcome = false,
	children,
}: {
	canSend: boolean;
	onSend(): void;
	sendLabel: string;
	onAbort?: () => void;
	welcome?: boolean;
	children: ReactNode;
}) {
	const theme = useTheme();
	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
			{onAbort ? (
				<IconButton
					accessibilityLabel="Abort"
					onPress={onAbort}
					round
					background={theme.color.text}
					pressedBackground={theme.color.danger}
				>
					<CircleStop size={16} color={theme.color.canvas} />
				</IconButton>
			) : null}
			{children}
			{!onAbort || canSend ? (
				<IconButton
					accessibilityLabel={sendLabel}
					onPress={onSend}
					disabled={!canSend}
					round={!welcome}
					padding={0}
					background={welcome ? "transparent" : theme.brand.primary}
					pressedBackground={
						welcome
							? theme.color.surfaceMuted
							: withAlpha(theme.brand.primary, 0.8)
					}
				>
					{welcome ? (
						<LinearGradient
							colors={
								canSend
									? [...theme.brand.sendGradient]
									: [theme.color.surfaceMuted, theme.color.surfaceMuted]
							}
							start={{ x: 0, y: 0 }}
							end={{ x: 1, y: 1 }}
							style={{
								width: 32,
								height: 32,
								borderRadius: 16,
								alignItems: "center",
								justifyContent: "center",
							}}
						>
							<ArrowUp
								size={17}
								color={canSend ? theme.brand.onPrimary : theme.color.textMuted}
							/>
						</LinearGradient>
					) : (
						<ArrowUp size={16} color={theme.brand.onPrimary} />
					)}
				</IconButton>
			) : null}
		</View>
	);
}
