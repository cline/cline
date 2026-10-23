/**
 * One auto-approve tier, as a labelled row with a switch.
 *
 * Rendered by both the Settings screen and the composer's auto-approve sheet.
 * The two differ only in the surface underneath, hence `variant`: a Settings
 * list wants a bordered card per row, while the sheet already sits on a raised
 * panel and reads better as a flat list with hairlines between rows.
 */

import { View } from "react-native";
import type { ApprovalTier } from "@/session";
import { Card, Text, Toggle, useTheme } from "@/ui";
import { TIER_COPY } from "./policy-copy";

export interface ApprovalTierRowProps {
	tier: ApprovalTier;
	/** True when this tier is set to `auto`. */
	value: boolean;
	onChange(next: boolean): void;
	/** `card` (Settings list) or `plain` (inside a sheet). Default `card`. */
	variant?: "card" | "plain";
}

export function ApprovalTierRow({
	tier,
	value,
	onChange,
	variant = "card",
}: ApprovalTierRowProps) {
	const theme = useTheme();
	const { label, risk, icon: Icon } = TIER_COPY[tier];

	const body = (
		<>
			<Icon size={16} color={theme.color.textMuted} />
			<View style={{ flex: 1, gap: 2 }}>
				<Text variant="body" weight="500">
					{label}
				</Text>
				<Text variant="caption" tone="muted">
					{risk}
				</Text>
				<Text variant="caption" tone={value ? "accent" : "muted"}>
					{value ? "Runs automatically" : "Asks every time"}
				</Text>
			</View>
			<Toggle
				value={value}
				accessibilityLabel={`Auto-approve ${label}`}
				accessibilityHint={risk}
				onChange={onChange}
			/>
		</>
	);

	if (variant === "plain") {
		return (
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					gap: 12,
					paddingVertical: 10,
				}}
			>
				{body}
			</View>
		);
	}

	return (
		<Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
			{body}
		</Card>
	);
}
