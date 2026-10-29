/**
 * The run-outcome card, shown at the foot of the transcript when a run this
 * client watched reaches a terminal state. It answers the phone's core
 * question — "what happened while I was away?" — in one glance: outcome,
 * duration, and what was touched, with per-file ± counts.
 *
 * Only rendered for watched runs (`view.lastRun` is live-only) and only when
 * the run used tools; a chat-only answer needs no card under it.
 */

import { CircleCheck, CircleSlash, CircleX } from "lucide-react-native";
import { View } from "react-native";
import type { LastRunView } from "@/session";
import { withAlpha } from "@/theme/brand";
import { Text, useTheme } from "@/ui";
import { formatRunDuration, type RunSummary } from "./run-summary";

const FILES_SHOWN = 4;

const OUTCOME_COPY = {
	completed: "Run finished",
	aborted: "Run stopped",
	failed: "Run failed",
} as const;

export function RunSummaryCard({
	lastRun,
	summary,
}: {
	lastRun: LastRunView;
	summary: RunSummary;
}) {
	const theme = useTheme();
	const outcome = lastRun.outcome ?? "completed";
	const failed = outcome === "failed";
	const Icon =
		outcome === "completed"
			? CircleCheck
			: outcome === "aborted"
				? CircleSlash
				: CircleX;
	const tint = failed ? theme.color.danger : theme.color.textMuted;
	const duration = formatRunDuration(lastRun.startedAt, lastRun.endedAt);
	const files = summary.files.slice(0, FILES_SHOWN);
	const moreFiles = summary.files.length - files.length;
	const hasDetails = failed || summary.failedCount > 0 || files.length > 0;
	const headline = [
		OUTCOME_COPY[outcome],
		duration,
		`${summary.toolCount} ${summary.toolCount === 1 ? "tool" : "tools"}`,
	]
		.filter(Boolean)
		.join(" · ");

	return (
		<View
			testID="run-summary"
			accessible
			accessibilityLabel={`${headline}. ${
				summary.files.length > 0
					? `${summary.files.length} ${summary.files.length === 1 ? "file" : "files"} changed`
					: "No files changed"
			}`}
			style={{
				marginTop: 8,
				borderWidth: hasDetails ? 1 : 0,
				borderColor: failed ? withAlpha(tint, 0.35) : theme.color.border,
				borderRadius: theme.radius.md,
				backgroundColor: failed ? withAlpha(tint, 0.07) : "transparent",
				paddingHorizontal: hasDetails ? 12 : 0,
				paddingVertical: hasDetails ? 10 : 6,
				gap: 6,
			}}
		>
			<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
				<Icon size={15} color={tint} />
				<Text
					variant="small"
					tone={failed ? "danger" : "muted"}
					style={{ flex: 1 }}
				>
					{headline}
				</Text>
				{summary.additions > 0 || summary.deletions > 0 ? (
					<View style={{ flexDirection: "row", gap: 6 }}>
						{summary.additions > 0 ? (
							<Text variant="mono" color={theme.feedback.success.fg}>
								+{summary.additions}
							</Text>
						) : null}
						{summary.deletions > 0 ? (
							<Text variant="mono" tone="danger">
								−{summary.deletions}
							</Text>
						) : null}
					</View>
				) : null}
			</View>

			{summary.failedCount > 0 ? (
				<Text variant="caption" tone="danger">
					{summary.failedCount}{" "}
					{summary.failedCount === 1 ? "tool call" : "tool calls"} failed — see
					the transcript above.
				</Text>
			) : null}

			{files.map((file) => (
				<View
					key={file.path}
					style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
				>
					<Text
						variant="mono"
						tone="muted"
						numberOfLines={1}
						style={{ flex: 1 }}
					>
						{file.path}
					</Text>
					{file.additions > 0 ? (
						<Text variant="mono" color={theme.feedback.success.fg}>
							+{file.additions}
						</Text>
					) : null}
					{file.deletions > 0 ? (
						<Text variant="mono" tone="danger">
							−{file.deletions}
						</Text>
					) : null}
				</View>
			))}
			{moreFiles > 0 ? (
				<Text variant="caption" tone="muted">
					and {moreFiles} more {moreFiles === 1 ? "file" : "files"}
				</Text>
			) : null}
		</View>
	);
}
