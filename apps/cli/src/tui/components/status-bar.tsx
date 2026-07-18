import type { AgentMode } from "@cline/core";
import { useTerminalDimensions } from "@opentui/react";
import {
	shouldShowCliUsageCost,
	shouldShowCliUsageCoveredBySubscription,
} from "../../utils/usage-cost-display";
import {
	useTerminalBackground,
	useTerminalTheme,
} from "../hooks/use-terminal-background";
import {
	getDefaultForeground,
	getModeAccent,
	getSuccessColor,
} from "../palette";
import { HOME_VIEW_MAX_WIDTH } from "../types";
import { fitStatusRow, truncateToWidth } from "../utils/responsive-layout";

export function createContextBar(
	used: number,
	total?: number,
	width = 6,
): { filled: string; empty: string } {
	const normalizedWidth = Math.max(0, Math.floor(width));
	const ratio = total && total > 0 ? Math.min(used / total, 1) : 0;
	const filledCount =
		total && total > 0 && used > 0
			? used >= total
				? normalizedWidth
				: Math.min(
						Math.max(1, Math.ceil(ratio * normalizedWidth)),
						Math.max(0, normalizedWidth - 1),
					)
			: 0;
	const emptyCount = Math.max(0, normalizedWidth - filledCount);
	return {
		filled: "\u2588".repeat(filledCount),
		empty: "\u2588".repeat(emptyCount),
	};
}

export function resolveContextBarFilledForeground(
	defaultForeground: string | undefined,
): string {
	return defaultForeground ?? "#ffffff";
}

export function getWorkspaceDisplayName(
	workspaceRoot: string | undefined,
): string {
	if (!workspaceRoot) return "";
	const trimmedRoot = workspaceRoot.replace(/[\\/]+$/, "");
	if (!trimmedRoot) return workspaceRoot;
	return trimmedRoot.split(/[\\/]/).pop() ?? workspaceRoot;
}

function formatCost(cost: number): string {
	return `$${cost.toFixed(2)}`;
}

function formatCostText(providerId: string, totalCost: number): string {
	// Subscription providers (ClinePass) have no per-use cost worth surfacing.
	if (shouldShowCliUsageCoveredBySubscription(providerId)) {
		return "";
	}

	if (!shouldShowCliUsageCost(providerId)) {
		return "";
	}

	return formatCost(totalCost);
}

export function formatStatusBarUsageText(input: {
	totalTokens: number;
	totalCost: number;
	providerId: string;
}): string {
	const tokens = `(${input.totalTokens.toLocaleString()})`;
	const costText = formatCostText(input.providerId, input.totalCost);

	if (!costText) {
		return tokens;
	}

	return `${tokens} ${costText}`;
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
	providerId?: string;
	modelId: string;
	knownModels?: Record<string, unknown>;
	thinking?: boolean;
	reasoningEffort?: string;
}): string {
	const info = lookupModelInfo(config.modelId, config.knownModels);
	const modelIdTail = config.modelId.split("/").pop() ?? config.modelId;
	let displayName = info?.name ?? modelIdTail;
	if (config.thinking && config.reasoningEffort) {
		displayName = `${displayName} (${config.reasoningEffort})`;
	}
	if (config.providerId === "cline-pass") {
		displayName = `ClinePass: ${displayName}`;
	}
	return displayName;
}

export function resolveModelMaxInputTokens(config: {
	modelId: string;
	knownModels?: Record<string, unknown>;
}): number | undefined {
	const info = (lookupModelInfo(config.modelId, config.knownModels) ?? {}) as {
		maxInputTokens?: number;
		contextWindow?: number;
	};
	if (typeof info.maxInputTokens === "number" && info.maxInputTokens > 0) {
		return info.maxInputTokens;
	}
	if (typeof info.contextWindow === "number" && info.contextWindow > 0) {
		return info.contextWindow;
	}
	return undefined;
}

export interface StatusBarProps {
	providerId: string;
	modelId: string;
	totalTokens: number;
	totalCost: number;
	maxInputTokens?: number;
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
		maxInputTokens,
		uiMode,
		autoApproveAll,
		workspaceName,
		gitBranch,
		gitDiffStats,
		onToggleMode,
	} = props;

	const { width } = useTerminalDimensions();
	const terminalBg = useTerminalBackground();
	const terminalTheme = useTerminalTheme();
	const defaultFg = getDefaultForeground(terminalBg);
	const contextBarFilledFg = resolveContextBarFilledForeground(defaultFg);
	const actAccent = getModeAccent("act", terminalTheme);
	const planAccent = getModeAccent("plan", terminalTheme);
	const successColor = getSuccessColor(terminalTheme);
	const hasMaxInputTokens =
		typeof maxInputTokens === "number" &&
		Number.isFinite(maxInputTokens) &&
		maxInputTokens > 0;
	const bar = hasMaxInputTokens
		? createContextBar(totalTokens, maxInputTokens)
		: undefined;

	// Keep the footer within the terminal at every width. The full layout uses
	// two dense rows; narrow terminals switch to compact labels and omit
	// secondary details before they can wrap.
	const avail = Math.max(
		1,
		props.variant === "home"
			? Math.min(width, HOME_VIEW_MAX_WIDTH) - 2
			: width - 2,
	);
	const compact = avail < 48;
	const activeModeLabel = uiMode === "plan" ? "● Plan" : "● Act";
	const modeWidth = compact ? activeModeLabel.length : 18;
	const modelRow = fitStatusRow(avail, modeWidth);
	const usageText = formatStatusBarUsageText({
		totalTokens,
		totalCost,
		providerId: props.providerId,
	});
	const hasUsage = totalTokens > 0 || totalCost > 0;
	const fullContextText = bar
		? ` ${bar.filled}${bar.empty} ${usageText}`
		: ` ${usageText}`;
	const compactContextText = ` ${usageText}`;
	const preferredContextText = compact ? compactContextText : fullContextText;
	const contextText = !hasUsage
		? ""
		: preferredContextText.length <= modelRow.leftWidth - 8
			? preferredContextText
			: compactContextText.length <= modelRow.leftWidth - 8
				? compactContextText
				: "";
	const showContextBar =
		Boolean(bar) && !compact && contextText === fullContextText;
	const renderContextText = () => (
		<>
			{" "}
			{showContextBar && bar && (
				<>
					<span fg={contextBarFilledFg}>{bar.filled}</span>
					<span fg="gray">{bar.empty}</span>{" "}
				</>
			)}
			{usageText}
		</>
	);
	const truncatedModel = truncateToWidth(
		modelId,
		Math.max(1, modelRow.leftWidth - contextText.length),
	);

	const approvalLabel = compact
		? autoApproveAll
			? "Auto: all"
			: "Auto: safe"
		: autoApproveAll
			? "Auto: all (Shift+Tab)"
			: "Auto: safe (Shift+Tab)";
	const repoRow = fitStatusRow(avail, approvalLabel.length);
	const pathPart = workspaceName + (gitBranch ? ` (${gitBranch})` : "");
	const diffStats =
		gitDiffStats && gitDiffStats.files > 0 ? gitDiffStats : null;
	const diffLabel = diffStats
		? compact
			? `${diffStats.files}f +${diffStats.additions} -${diffStats.deletions}`
			: `${diffStats.files} file${diffStats.files !== 1 ? "s" : ""} +${diffStats.additions} -${diffStats.deletions}`
		: "";
	const diffSeparator = pathPart ? " | " : "";
	const showDiff =
		Boolean(diffStats) &&
		repoRow.leftWidth >=
			diffSeparator.length + diffLabel.length + (pathPart ? 6 : 0);
	const pathMax = Math.max(
		0,
		repoRow.leftWidth -
			(showDiff ? diffSeparator.length + diffLabel.length : 0),
	);
	const truncatedPath = truncateToWidth(pathPart, pathMax);
	const activeModeAccent = uiMode === "plan" ? planAccent : actAccent;

	return (
		<box flexDirection="column" paddingX={1}>
			<box
				flexDirection="row"
				gap={modelRow.showRight ? 1 : 0}
				overflow="hidden"
			>
				<text
					fg="gray"
					width={modelRow.leftWidth}
					flexShrink={0}
					overflow="hidden"
					wrapMode="none"
				>
					{truncatedModel}
					{contextText && renderContextText()}
				</text>
				{modelRow.showRight && (
					<box
						flexDirection="row"
						gap={compact ? 0 : 1}
						flexShrink={0}
						onMouseDown={onToggleMode}
					>
						{compact ? (
							<text fg={activeModeAccent}>{activeModeLabel}</text>
						) : (
							<>
								<text fg={uiMode === "plan" ? planAccent : "gray"}>
									{uiMode === "plan" ? "●" : "○"} Plan
								</text>
								<text fg={uiMode === "act" ? actAccent : "gray"}>
									{uiMode === "act" ? "●" : "○"} Act
								</text>
								<text fg="gray">(Tab)</text>
							</>
						)}
					</box>
				)}
			</box>
			<box
				flexDirection="row"
				gap={repoRow.showRight ? 1 : 0}
				overflow="hidden"
			>
				<text
					fg={defaultFg}
					width={repoRow.leftWidth}
					flexShrink={0}
					overflow="hidden"
					wrapMode="none"
				>
					{truncatedPath}
					{showDiff && diffStats && (
						<span fg="gray">
							{diffSeparator}
							{compact
								? `${diffStats.files}f`
								: `${diffStats.files} file${diffStats.files !== 1 ? "s" : ""}`}{" "}
							<span fg={successColor}>+{diffStats.additions}</span>{" "}
							<span fg="red">-{diffStats.deletions}</span>
						</span>
					)}
				</text>
				{repoRow.showRight && (
					<text fg={autoApproveAll ? successColor : "gray"} flexShrink={0}>
						{approvalLabel}
					</text>
				)}
			</box>
		</box>
	);
}
