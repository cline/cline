/**
 * One session in the home list.
 *
 * Reading order is deliberate: **what the work is** (title), then **where it
 * runs** (a location badge — informational, never a choice), then **whether it is
 * up** (a dot only when that is actually observable), then when it last moved and
 * its status chip.
 *
 * The dot is drawn only for `row.online`. `online: false` means "not known to be
 * online", so nothing is drawn and nothing is said — an offline dot the app cannot
 * back up would be a lie about someone's laptop.
 */

import { ChevronRight, Cloud, MonitorSmartphone } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { channel } from "@/theme/surfaces";
import { SessionStatusChip, StatusDot, Text, useTheme } from "@/ui";
import type { SessionActionTriggerProps } from "./SessionActions";
import { describeActivity, type SessionRow } from "./session-rows";

export interface SessionRowViewProps extends SessionActionTriggerProps {
	row: SessionRow;
	/** Clock for the relative time, injected so rows render deterministically. */
	now: number;
	/** The session this app is currently connected to. */
	active?: boolean;
	/** Desktop-density treatment used inside the slide-over session sidebar. */
	compact?: boolean;
	onPress(): void;
}

export function SessionRowView({
	row,
	now,
	active = false,
	compact = false,
	pending = false,
	onPress,
	onLongPress,
	accessibilityActions,
	onAccessibilityAction,
}: SessionRowViewProps) {
	const theme = useTheme();
	const activity = describeActivity(row, now);
	const unread = row.unread === true && !active;
	const Icon = row.location.kind === "cloud" ? Cloud : MonitorSmartphone;
	const openLabel =
		row.kind === "computer"
			? `Open ${row.title}`
			: `Open ${row.title} on ${row.location.name}`;
	const onlineLabel = row.kind === "computer" ? row.title : row.location.name;

	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={openLabel}
			accessibilityHint={[
				unread ? "Unread activity" : undefined,
				row.online ? "Online" : undefined,
				pending
					? "Updating session"
					: row.status
						? `Status ${row.statusLabel ?? row.status}`
						: undefined,
				activity,
				row.snippet,
			]
				.filter(Boolean)
				.join(", ")}
			onPress={onPress}
			onLongPress={onLongPress}
			accessibilityActions={accessibilityActions}
			onAccessibilityAction={onAccessibilityAction}
			style={({ pressed }) => ({
				flexDirection: "row",
				alignItems: "center",
				gap: compact ? 7 : 10,
				borderRadius: theme.radius.md,
				paddingHorizontal: 8,
				paddingVertical: compact ? 7 : 9,
				minHeight: 44,
				// `--sidebar-accent` is the active row fill; pressed lifts one further
				// to `--accent`, which is how the desktop sidebar distinguishes them.
				backgroundColor: pressed
					? theme.color.surfaceHover
					: active
						? theme.color.surfaceMuted
						: channel.maskClear,
				// The active session keeps a violet edge — the accent marks the live
				// thing, it is not sprinkled on every row.
				borderLeftWidth: !compact && active ? 2 : 0,
				borderLeftColor: !compact && active ? theme.brand.violet : undefined,
			})}
		>
			{compact && row.kind === "computer" && row.online ? (
				<View accessible accessibilityLabel={`${onlineLabel} is online`}>
					<StatusDot tone="running" size={6} />
				</View>
			) : null}
			{!compact ? (
				<View
					style={{
						width: 32,
						height: 32,
						borderRadius: theme.radius.md,
						backgroundColor: theme.brand.violetSubtle,
						alignItems: "center",
						justifyContent: "center",
					}}
				>
					<Icon size={16} color={theme.brand.violet} />
				</View>
			) : null}

			<View style={{ flex: 1, gap: 3 }}>
				<Text variant="body" weight="500" numberOfLines={1}>
					{row.title}
				</Text>
				{!compact && row.snippet && row.snippet !== row.title ? (
					<Text variant="small" tone="muted" numberOfLines={1}>
						{row.snippet}
					</Text>
				) : null}
				<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
					{!compact && row.online ? (
						// A bare dot says nothing out of context, so the phrasing lives on
						// an accessible wrapper — exactly what the dot is claiming.
						<View accessible accessibilityLabel={`${onlineLabel} is online`}>
							<StatusDot tone="running" size={8} />
						</View>
					) : null}
					{row.kind === "session" ? (
						<Text variant="caption" tone="muted" numberOfLines={1}>
							{row.location.name}
						</Text>
					) : null}
					{activity && !compact ? (
						<>
							{row.kind === "session" ? (
								<Text variant="caption" tone="muted">
									·
								</Text>
							) : null}
							<Text variant="caption" tone="muted" numberOfLines={1}>
								{activity}
							</Text>
						</>
					) : row.kind === "computer" ? (
						<Text variant="caption" tone="muted">
							Tap to connect
						</Text>
					) : null}
				</View>
				{compact && (row.status || unread || pending) ? (
					<SessionStatusChip
						sidebar
						pending={pending}
						status={row.status ?? "unknown"}
						unread={unread}
						label={
							(pending ? "Updating…" : row.statusLabel) ??
							(!row.status && unread ? "Unread activity" : undefined)
						}
						plain
					/>
				) : null}
			</View>

			{/* No status is known for a machine we are not connected to, so the chip
			    is omitted rather than defaulting to a cheerful "Idle". */}
			{!compact && (row.status || unread) ? (
				<SessionStatusChip
					status={row.status ?? "unknown"}
					unread={unread}
					label={
						row.statusLabel ??
						(!row.status && unread ? "Unread activity" : undefined)
					}
					plain
				/>
			) : null}
			{compact && activity ? (
				<Text variant="caption" tone="muted" numberOfLines={1}>
					{activity.replace(/^(Updated|Opened) /, "")}
				</Text>
			) : null}
			{!compact ? (
				<ChevronRight size={16} color={theme.color.textMuted} />
			) : null}
		</Pressable>
	);
}
