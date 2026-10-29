/**
 * The chat header (DESIGN_SPEC §1 spacing/type + §3 status chip).
 *
 * Restructured from a single cramped row into three zones so the title has room
 * to breathe on a phone:
 *
 *   [ sessions 44pt ] [ session title + location/status (flex) ]
 *
 * The meta line carries desktop's quiet dot + status and a human location, so the
 * status is still glanceable without exposing transport URLs or duplicating the
 * back-to-sessions action with a second icon.
 */

import {
	ChevronLeft,
	ExternalLink,
	PanelLeft,
	Plus,
	Search,
} from "lucide-react-native";
import { Keyboard, View } from "react-native";
import type { RemoteSessionStatus, RunStatus } from "@/session";
import { IconButton, SessionStatusChip, Text, useTheme } from "@/ui";

/**
 * Ellipsize the MIDDLE of `value`, keeping both ends readable. Used instead of
 * `ellipsizeMode="middle"` because that prop is iOS-only for multiline-capable
 * text and this string must render identically on both platforms.
 */
export function truncateMiddle(value: string, max = 34): string {
	if (value.length <= max) {
		return value;
	}
	// Bias toward the tail: the port/path end identifies a hub, the scheme doesn't.
	const tail = Math.ceil((max - 1) * 0.55);
	const head = max - 1 - tail;
	return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}

export interface ChatHeaderProps {
	title: string;
	horizontalInsets?: { left: number; right: number };
	/** Human-readable session location, shown under the title. */
	subtitle?: string;
	runStatus: RunStatus | RemoteSessionStatus;
	showStatus?: boolean;
	/** A parked tool is waiting for consent, rather than executing. */
	pendingApproval?: boolean;
	onBack?: () => void;
	onSwitchSession?: () => void;
	onNewSession?: () => void;
	onReviewBranch?: () => void;
	onFindInConversation?: () => void;
}

export function ChatHeader({
	title,
	horizontalInsets = { left: 0, right: 0 },
	subtitle,
	runStatus,
	showStatus = true,
	pendingApproval = false,
	onBack,
	onSwitchSession,
	onNewSession,
	onReviewBranch,
	onFindInConversation,
}: ChatHeaderProps) {
	const theme = useTheme();
	const openSessions = onSwitchSession ?? onBack;
	const opensSidebar = Boolean(onSwitchSession);
	return (
		<View
			style={{
				flexDirection: "row",
				alignItems: "center",
				gap: 4,
				minHeight: 56,
				paddingLeft: horizontalInsets.left + (openSessions ? 4 : 16),
				paddingRight: horizontalInsets.right + 4,
				paddingVertical: 6,
				backgroundColor: theme.color.surface,
				borderBottomWidth: 1,
				borderBottomColor: theme.color.border,
			}}
		>
			{openSessions ? (
				<IconButton
					accessibilityLabel={opensSidebar ? "All sessions" : "Back"}
					onPress={openSessions}
				>
					{opensSidebar ? (
						<PanelLeft size={21} color={theme.color.text} />
					) : (
						<ChevronLeft size={21} color={theme.color.text} />
					)}
				</IconButton>
			) : null}

			<View style={{ flex: 1, minWidth: 0, gap: 2, justifyContent: "center" }}>
				{/* Medium (`--font-weight-medium`), not semibold: desktop keeps semibold
				    for the hero and markdown headings and titles chrome at medium. */}
				<Text variant="body" weight="500" numberOfLines={1}>
					{title}
				</Text>
				<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
					{showStatus ? (
						<SessionStatusChip
							status={pendingApproval ? "idle" : runStatus}
							label={pendingApproval ? "Waiting for approval" : undefined}
							plain
						/>
					) : null}
					{subtitle ? (
						<Text
							variant="caption"
							tone="muted"
							numberOfLines={1}
							accessibilityLabel={subtitle}
							style={{ flexShrink: 1, minWidth: 0 }}
						>
							{truncateMiddle(subtitle)}
						</Text>
					) : null}
				</View>
			</View>
			{onFindInConversation ? (
				<IconButton
					accessibilityLabel="Find in conversation"
					onPress={onFindInConversation}
				>
					<Search size={18} color={theme.color.textMuted} />
				</IconButton>
			) : null}
			{onReviewBranch ? (
				<IconButton
					accessibilityLabel="Review branch on GitHub"
					onPress={onReviewBranch}
				>
					<ExternalLink size={18} color={theme.color.textMuted} />
				</IconButton>
			) : null}
			{onNewSession ? (
				<IconButton
					accessibilityLabel="New session"
					onPress={() => {
						Keyboard.dismiss();
						onNewSession();
					}}
				>
					<Plus size={20} color={theme.color.textMuted} />
				</IconButton>
			) : null}
		</View>
	);
}
