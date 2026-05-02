import type { AgentMode } from "@clinebot/core";
import { useTerminalDimensions } from "@opentui/react";
import { useTerminalBackground } from "../hooks/use-terminal-background";
import { getDefaultForeground, palette } from "../palette";
import { HOME_VIEW_MAX_WIDTH } from "../types";

function createContextBar(
	used: number,
	total?: number,
	width = 8,
): { filled: string; empty: string } {
	const ratio = total && total > 0 ? Math.min(used / total, 1) : 0;
	const filledCount =
		total && total > 0 && used > 0 ? Math.max(1, Math.round(ratio * width)) : 0;
	const emptyCount = Math.max(0, width - filledCount);
	return {
		filled: "\u2588".repeat(filledCount),
		empty: "\u2588".repeat(emptyCount),
	};
}

function formatCost(cost: number): string {
	if (cost < 0.01) return `$${cost.toFixed(4)}`;
	return `$${cost.toFixed(2)}`;
}

// knownModels keys are bare IDs ("claude-sonnet-4-6") but config.modelId
// may include a provider prefix ("anthropic/claude-sonnet-4-6"), so we
// try the full ID first, then strip the prefix and retry.
function lookupModelInfo(
	modelId: string,
	knownModels?: Record<string, unknown>,
): { name?: string } | undefined {
	if (!knownModels) return undefined;
	const candidates = [modelId, modelId.split("/").pop()];
	for (const key of candidates) {
		if (!key) continue;
		const hit = knownModels[key] as { name?: string } | undefined;
		if (hit) return hit;
	}
	return undefined;
}

export function resolveModelDisplayName(config: {
	modelId: string;
	knownModels?: Record<string, unknown>;
	thinking?: boolean;
	reasoningEffort?: string;
}): string {
	const info = lookupModelInfo(config.modelId, config.knownModels);
	const name = info?.name ?? config.modelId.split("/").pop() ?? config.modelId;
	if (config.thinking && config.reasoningEffort) {
		return `${name} (${config.reasoningEffort})`;
	}
	return name;
}

export function resolveModelContextWindow(config: {
	modelId: string;
	knownModels?: Record<string, unknown>;
}): number | undefined {
	const info = (lookupModelInfo(config.modelId, config.knownModels) ?? {}) as {
		contextWindow?: number;
		context_window?: number;
	};
	if (typeof info.contextWindow === "number" && info.contextWindow > 0) {
		return info.contextWindow;
	}
	if (typeof info.context_window === "number" && info.context_window > 0) {
		return info.context_window;
	}
	return undefined;
}

export interface StatusBarProps {
	providerId: string;
	modelId: string;
	totalTokens: number;
	totalCost: number;
	contextWindow?: number;
	uiMode: AgentMode;
	autoApproveAll: boolean;
	workspaceName: string;
	gitBranch: string | null;
	gitDiffStats: {
		files: number;
		additions: number;
		deletions: number;
	} | null;
	onToggleMode?: () => void;
	variant?: "home" | "chat";
}

export function StatusBar(props: StatusBarProps) {
	const {
		modelId,
		totalTokens,
		totalCost,
		contextWindow,
		uiMode,
		autoApproveAll,
		workspaceName,
		gitBranch,
		gitDiffStats,
		onToggleMode,
	} = props;

	const { width } = useTerminalDimensions();
	const terminalBg = useTerminalBackground();
	const defaultFg = getDefaultForeground(terminalBg);
	const hasContextWindow =
		typeof contextWindow === "number" &&
		Number.isFinite(contextWindow) &&
		contextWindow > 0;
	const bar = hasContextWindow
		? createContextBar(totalTokens, contextWindow)
		: undefined;

	// Available content width after accounting for padding.
	// Home view: parent box is capped at 60 wide, status bar adds paddingX=1 (-2).
	// Chat view: status bar adds paddingX=1 (-2).
	const avail =
		props.variant === "home"
			? Math.min(width, HOME_VIEW_MAX_WIDTH) - 2
			: width - 2;

	// Row 1 layout: [model + context info] .... [Plan/Act toggle]
	// When the full row doesn't fit, context info drops to its own row 2.
	// Model ID truncates with "..." before wrapping; toggle stays right-aligned.
	const toggleWidth = 20;
	const usageText = `(${totalTokens.toLocaleString()}) ${formatCost(totalCost)}`;
	const contextText = bar
		? ` ${bar.filled}${bar.empty} ${usageText}`
		: ` ${usageText}`;
	const firstRowFits =
		modelId.length + contextText.length + toggleWidth + 1 <= avail;

	const modelMaxLen = Math.max(
		10,
		avail - toggleWidth - (firstRowFits ? contextText.length : 0) - 1,
	);
	const truncatedModel =
		modelId.length > modelMaxLen
			? `${modelId.slice(0, modelMaxLen - 3)}...`
			: modelId;

	// Repo row: [workspace (branch) | N files +X -Y]
	// Git stats stay visible; path/branch truncates with "..." when narrow.
	const hasGitDiff = gitDiffStats && gitDiffStats.files > 0;
	const gitSuffix = hasGitDiff
		? ` | ${gitDiffStats.files} file${gitDiffStats.files !== 1 ? "s" : ""} +${gitDiffStats.additions} -${gitDiffStats.deletions}`
		: "";
	const pathPart = workspaceName + (gitBranch ? ` (${gitBranch})` : "");
	const pathMax = Math.max(5, avail - gitSuffix.length);
	const truncatedPath =
		pathPart.length > pathMax
			? `${pathPart.slice(0, pathMax - 3)}...`
			: pathPart;
	return (
		<box flexDirection="column" paddingX={1}>
			<box flexDirection="row" justifyContent="space-between">
				<text fg="gray">
					{truncatedModel}
					{firstRowFits && contextText}
				</text>
				<box
					flexDirection="row"
					gap={1}
					flexShrink={0}
					onMouseDown={onToggleMode}
				>
					<text fg={uiMode === "plan" ? palette.plan : "gray"}>
						{uiMode === "plan" ? "●" : "○"} Plan
					</text>
					<text fg={uiMode === "act" ? palette.act : "gray"}>
						{uiMode === "act" ? "●" : "○"} Act
					</text>
					<text fg="gray">(Tab)</text>
				</box>
			</box>

			{!firstRowFits && <text fg="gray">{contextText.trimStart()}</text>}

			<text fg={defaultFg}>
				{truncatedPath}
				{hasGitDiff && (
					<span fg="gray">
						{" | "}
						{gitDiffStats.files} file
						{gitDiffStats.files !== 1 ? "s" : ""}{" "}
						<span fg={palette.success}>+{gitDiffStats.additions}</span>{" "}
						<span fg="red">-{gitDiffStats.deletions}</span>
					</span>
				)}
			</text>

			{autoApproveAll ? (
				<text fg={defaultFg}>
					<span fg={palette.success}>
						{"\u23f5\u23f5"} Auto-approve all enabled
					</span>
					<span fg="gray"> (Shift+Tab)</span>
				</text>
			) : (
				<text fg="gray">Auto-approve all disabled (Shift+Tab)</text>
			)}
		</box>
	);
}
