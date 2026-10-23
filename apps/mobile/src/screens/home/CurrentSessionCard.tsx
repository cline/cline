/** A single live session promoted above history: Home's remote-control target. */

import { ChevronRight, Cloud, MonitorSmartphone } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { SessionStatusChip, Text, useTheme } from "@/ui";
import { describeActivity, type SessionRow } from "./session-rows";

export interface CurrentSessionCardProps {
	row: SessionRow;
	now: number;
	onPress(): void;
}

export function CurrentSessionCard({
	row,
	now,
	onPress,
}: CurrentSessionCardProps) {
	const theme = useTheme();
	const Icon = row.location.kind === "cloud" ? Cloud : MonitorSmartphone;
	const activity = describeActivity(row, now);

	return (
		<View style={{ gap: 8 }}>
			<Text variant="caption" tone="muted" weight="600">
				CURRENT
			</Text>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={`Resume ${row.title}`}
				accessibilityHint={`${row.location.name}${row.status ? `, ${row.status}` : ""}`}
				onPress={onPress}
				style={({ pressed }) => ({
					gap: 12,
					padding: 16,
					borderRadius: theme.radius.lg,
					borderWidth: 1,
					borderColor: pressed ? theme.brand.violet : theme.color.border,
					backgroundColor: pressed
						? theme.color.surfaceHover
						: theme.color.surfaceRaised,
				})}
			>
				<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
					<Icon size={16} color={theme.brand.violet} />
					<Text
						variant="small"
						tone="muted"
						style={{ flex: 1 }}
						numberOfLines={1}
					>
						{row.location.name}
					</Text>
					{row.status ? <SessionStatusChip status={row.status} plain /> : null}
				</View>

				<View style={{ gap: 4 }}>
					<Text variant="heading" numberOfLines={2}>
						{row.title}
					</Text>
					{activity ? (
						<Text variant="caption" tone="muted">
							{activity}
						</Text>
					) : null}
				</View>

				<View
					style={{
						flexDirection: "row",
						alignItems: "center",
						justifyContent: "flex-end",
						gap: 4,
					}}
				>
					<Text variant="body" weight="500" color={theme.brand.violet}>
						Resume
					</Text>
					<ChevronRight size={17} color={theme.brand.violet} />
				</View>
			</Pressable>
		</View>
	);
}
