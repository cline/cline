import { Box, Text } from "ink";
import React from "react";

interface DiffStats {
	files: number;
	additions: number;
	deletions: number;
}

interface ContextBar {
	filled: string;
	empty: string;
}

interface StatusBarProps {
	isConfigViewOpen: boolean;
	isRunning: boolean;
	isExitRequested: boolean;
	uiMode: "act" | "plan";
	providerId: string;
	modelId: string;
	contextBar: ContextBar;
	lastTotalTokens: number;
	lastTotalCost: number;
	workspaceName: string;
	gitBranch: string | null;
	gitDiffStats: DiffStats | null;
	autoApproveAll: boolean;
}

export function StatusBar({
	isConfigViewOpen,
	isRunning,
	isExitRequested,
	uiMode,
	providerId,
	modelId,
	contextBar,
	lastTotalTokens,
	lastTotalCost,
	workspaceName,
	gitBranch,
	gitDiffStats,
	autoApproveAll,
}: StatusBarProps): React.ReactElement {
	const renderModeSelector = React.createElement(
		Box,
		{ gap: 1 },
		React.createElement(
			Text,
			{
				color: uiMode === "plan" ? "yellow" : "gray",
				bold: uiMode === "plan",
			},
			`${uiMode === "plan" ? "●" : "○"} Plan`,
		),
		React.createElement(
			Text,
			{
				color: uiMode === "act" ? "blue" : "gray",
				bold: uiMode === "act",
			},
			`${uiMode === "act" ? "●" : "○"} Act`,
		),
		React.createElement(Text, { color: "gray" }, "(Tab)"),
	);

	const renderGitDiffStats =
		gitDiffStats && gitDiffStats.files > 0
			? React.createElement(
					Text,
					{ color: "gray" },
					` | ${gitDiffStats.files} file${gitDiffStats.files !== 1 ? "s" : ""} `,
					React.createElement(
						Text,
						{ color: "green" },
						`+${gitDiffStats.additions}`,
					),
					" ",
					React.createElement(
						Text,
						{ color: "red" },
						`-${gitDiffStats.deletions}`,
					),
				)
			: null;

	const renderAutoApprove = autoApproveAll
		? React.createElement(
				Text,
				null,
				React.createElement(
					Text,
					{ color: "green" },
					"⏵⏵ Auto-approve all enabled",
				),
				React.createElement(Text, { color: "gray" }, " (Shift+Tab)"),
			)
		: React.createElement(
				Text,
				{ color: "gray" },
				"Auto-approve all disabled (Shift+Tab)",
			);

	const renderQueueHint =
		!isConfigViewOpen && !isExitRequested
			? React.createElement(
					Text,
					{ color: "gray" },
					isRunning
						? "Enter queues while running · Ctrl+S steers the next turn"
						: "Enter submits · / for commands · @ for files",
				)
			: null;

	return React.createElement(
		Box,
		{ flexDirection: "column", marginTop: 1 },
		React.createElement(
			Box,
			{ justifyContent: "space-between" },
			React.createElement(
				Text,
				{ color: "gray" },
				isConfigViewOpen
					? "Config mode: Tab tabs \u00b7 \u2191/\u2193 navigate \u00b7 Esc close"
					: undefined,
			),
			isConfigViewOpen
				? React.createElement(Text, { color: "gray" }, "(Esc)")
				: renderModeSelector,
		),
		renderQueueHint,
		React.createElement(
			Box,
			null,
			React.createElement(Text, null, `${providerId} ${modelId} `),
			React.createElement(Text, null, contextBar.filled),
			React.createElement(Text, { color: "gray" }, contextBar.empty),
			React.createElement(
				Text,
				{ color: "gray" },
				` (${lastTotalTokens.toLocaleString()}) | $${lastTotalCost.toFixed(3)}`,
			),
		),
		React.createElement(
			Box,
			null,
			React.createElement(Text, null, workspaceName),
			gitBranch ? React.createElement(Text, null, ` (${gitBranch})`) : null,
			renderGitDiffStats,
		),
		renderAutoApprove,
	);
}
