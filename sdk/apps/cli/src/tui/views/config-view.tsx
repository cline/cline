import { useTerminalDimensions } from "@opentui/react";
import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import { useMemo, useState } from "react";
import type {
	InteractiveConfigData,
	InteractiveConfigItem,
	InteractiveConfigTab,
} from "../../tui/interactive-config";
import {
	formatCliCompactionMode,
	getNextCliCompactionMode,
} from "../../utils/compaction-mode";
import type { CliCompactionMode, Config } from "../../utils/types";
import { resolveModelDisplayName } from "../components/status-bar";
import { getModeAccent, palette } from "../palette";
import {
	type ConfigAction,
	getAdjacentConfigTab,
	getConfigFooterText,
	getConfigItemDisplayName,
	getConfigTabs,
	isInlineConfigAction,
	isToggleableConfigItem,
	resolveActiveConfigItems,
	resolveConfigItemSelectAction,
	resolveConfigItemToggleAction,
	toTabLabel,
} from "./config-view-helpers";

type ConfigRow =
	| { kind: "spacer" }
	| { kind: "head"; label: string; indent?: number }
	| { kind: "detail"; text: string }
	| { kind: "provider" }
	| { kind: "model" }
	| { kind: "toggle"; id: string; label: string }
	| { kind: "tool-group"; label: string; rightLabel: string; indent?: number }
	| {
			kind: "ext";
			name: string;
			path: string;
			source: InteractiveConfigItem["source"];
			enabled?: boolean;
			description?: string;
			item: InteractiveConfigItem;
			indent?: number;
			rightLabel?: string;
	  }
	| { kind: "mcp-manager" };

function sourceRank(source: InteractiveConfigItem["source"]): number {
	switch (source) {
		case "builtin":
			return 0;
		case "workspace":
			return 1;
		case "workspace-plugin":
			return 2;
		case "global":
			return 3;
		case "global-plugin":
			return 4;
	}
}

function sortBySourceThenName(
	items: InteractiveConfigItem[],
): InteractiveConfigItem[] {
	return [...items].sort((a, b) => {
		if (a.source !== b.source) {
			return sourceRank(a.source) - sourceRank(b.source);
		}
		return a.name.localeCompare(b.name);
	});
}

function isNavigable(row: ConfigRow): boolean {
	return (
		row.kind === "provider" ||
		row.kind === "model" ||
		row.kind === "toggle" ||
		row.kind === "ext" ||
		row.kind === "mcp-manager"
	);
}

function isToggleableRow(
	row: ConfigRow,
): row is Extract<ConfigRow, { kind: "ext" }> {
	return (
		row.kind === "ext" &&
		typeof row.enabled === "boolean" &&
		isToggleableConfigItem(row.item)
	);
}

function getVisibleWindow<T>(
	items: T[],
	center: number,
	maxVisible: number,
): { items: T[]; startIndex: number } {
	if (items.length <= maxVisible) return { items, startIndex: 0 };
	const half = Math.floor(maxVisible / 2);
	let start = Math.max(0, center - half);
	const end = Math.min(items.length, start + maxVisible);
	if (end - start < maxVisible) start = Math.max(0, end - maxVisible);
	return { items: items.slice(start, end), startIndex: start };
}

const COMPACTION_MODE_COLORS: Record<CliCompactionMode, string> = {
	agentic: palette.success,
	basic: "yellow",
	off: "gray",
};

export interface ConfigPanelProps extends ChoiceContext<ConfigAction> {
	config: Config;
	configData: InteractiveConfigData;
	providerDisplayName: string;
	currentMode: string;
	currentCompactionMode: CliCompactionMode;
	onToggleConfigItem?: (
		item: InteractiveConfigItem,
	) => Promise<InteractiveConfigData | undefined>;
	onToggleMode: () => void;
	onToggleAutoApprove: () => void;
	onSetCompactionMode: (mode: CliCompactionMode) => void;
}

function groupToolItems(
	items: InteractiveConfigItem[],
): Array<[string, InteractiveConfigItem[]]> {
	const groups = new Map<string, InteractiveConfigItem[]>();
	for (const item of items) {
		const groupKey = `${item.source}:${item.path}:${item.pluginName}`;
		const group = groups.get(groupKey) ?? [];
		group.push(item);
		groups.set(groupKey, group);
	}

	return [...groups.entries()].sort((left, right) => {
		const leftItem = left[1][0];
		const rightItem = right[1][0];
		const leftSource = leftItem?.source ?? "global-plugin";
		const rightSource = rightItem?.source ?? "global-plugin";
		if (leftSource !== rightSource) {
			return sourceRank(leftSource) - sourceRank(rightSource);
		}
		return (leftItem?.pluginName ?? "").localeCompare(
			rightItem?.pluginName ?? "",
		);
	});
}

function getSharedToolNames(items: InteractiveConfigItem[]): Set<string> {
	const counts = new Map<string, number>();
	for (const item of items) {
		counts.set(item.name, (counts.get(item.name) ?? 0) + 1);
	}
	return new Set(
		[...counts.entries()]
			.filter(([, count]) => count > 1)
			.map(([name]) => name),
	);
}

function appendToolGroupRows(
	rows: ConfigRow[],
	groups: Array<[string, InteractiveConfigItem[]]>,
	sharedToolNames: ReadonlySet<string>,
): void {
	for (const [, groupItems] of groups) {
		const first = groupItems[0];
		const enabledCount = groupItems.filter(
			(item) => item.enabled !== false,
		).length;
		rows.push({
			kind: "tool-group",
			label: first?.pluginName ?? "plugin",
			rightLabel: `${enabledCount}/${groupItems.length} tools enabled`,
			indent: 2,
		});
		for (const item of sortBySourceThenName(groupItems)) {
			rows.push({
				kind: "ext",
				name: item.name,
				path: item.path,
				source: item.source,
				enabled: item.enabled,
				description: item.description,
				item,
				indent: 4,
				rightLabel: sharedToolNames.has(item.name) ? "shared tool name" : "",
			});
		}
	}
}

function appendToolRows(
	rows: ConfigRow[],
	items: InteractiveConfigItem[],
): void {
	const builtinTools = sortBySourceThenName(
		items.filter((item) => !item.pluginName),
	);
	if (builtinTools.length > 0) {
		rows.push({ kind: "head", label: "Built-in" });
		for (const item of builtinTools) {
			rows.push({
				kind: "ext",
				name: item.name,
				path: item.path,
				source: item.source,
				enabled: item.enabled,
				description: item.description,
				item,
			});
		}
	}

	const pluginGroups = groupToolItems(items.filter((item) => item.pluginName));
	if (pluginGroups.length > 0) {
		rows.push({ kind: "head", label: "Plugins" });
		appendToolGroupRows(
			rows,
			pluginGroups,
			getSharedToolNames(items.filter((item) => item.pluginName)),
		);
	}
}

export function ConfigPanelContent(props: ConfigPanelProps) {
	const { resolve, dismiss, dialogId, config } = props;
	const { height } = useTerminalDimensions();

	const [mode, setMode] = useState(props.currentMode);
	const [autoApprove, setAutoApprove] = useState(
		config.toolPolicies["*"]?.autoApprove !== false,
	);
	const [verbose, setVerbose] = useState(config.verbose);
	const [compactionMode, setCompactionMode] = useState(
		props.currentCompactionMode,
	);
	const [activeTab, setActiveTab] = useState<InteractiveConfigTab>("general");
	const [configData, setConfigData] = useState(props.configData);
	const [togglingItemId, setTogglingItemId] = useState<string | null>(null);
	const [toggleError, setToggleError] = useState<string | undefined>();
	const [navPos, setNavPos] = useState(0);

	const displayName = resolveModelDisplayName(config);

	const rows = useMemo(() => {
		const r: ConfigRow[] = [];

		if (activeTab === "general") {
			r.push({ kind: "provider" });
			r.push({ kind: "model" });
			r.push({ kind: "toggle", id: "mode", label: "Mode" });
			r.push({ kind: "toggle", id: "compaction", label: "Compaction" });
			r.push({
				kind: "toggle",
				id: "auto-approve",
				label: "Auto-approve all",
			});
			r.push({ kind: "toggle", id: "verbose", label: "Verbose" });
		} else {
			const activeItems = resolveActiveConfigItems(configData, activeTab);
			r.push({
				kind: "head",
				label: `${toTabLabel(activeTab)} (${activeItems.length})`,
			});

			if (activeItems.length === 0) {
				r.push({
					kind: "detail",
					text: `No ${toTabLabel(activeTab).toLowerCase()} found.`,
				});
			} else if (activeTab === "tools") {
				appendToolRows(r, activeItems);
			} else {
				for (const item of activeItems) {
					r.push({
						kind: "ext",
						name: item.name,
						path: item.path,
						source: item.source,
						enabled: item.enabled,
						description: item.description,
						item,
					});
				}
			}

			if (activeTab === "mcp") {
				r.push({ kind: "mcp-manager" });
			}
		}

		return r;
	}, [activeTab, configData]);

	const navIndices = useMemo(
		() => rows.map((r, i) => (isNavigable(r) ? i : -1)).filter((i) => i >= 0),
		[rows],
	);

	const clampedNavPos = Math.min(navPos, Math.max(0, navIndices.length - 1));
	const selectedRowIdx = navIndices[clampedNavPos] ?? 0;

	const setNavPosition = (nextNavPos: number) => {
		setNavPos(nextNavPos);
	};

	const handleInlineToggle = async (item: InteractiveConfigItem) => {
		if (!props.onToggleConfigItem || togglingItemId) return;
		setTogglingItemId(item.id);
		setToggleError(undefined);
		try {
			const nextData = await props.onToggleConfigItem(item);
			if (nextData) {
				setConfigData(nextData);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setToggleError(`Failed to update ${item.name}: ${message}`);
		} finally {
			setTogglingItemId(null);
		}
	};

	const handleSelect = () => {
		const row = rows[selectedRowIdx];
		if (!row) return;
		switch (row.kind) {
			case "provider":
				resolve({ kind: "open-provider" });
				break;
			case "model":
				resolve({ kind: "open-model" });
				break;
			case "toggle":
				switch (row.id) {
					case "mode":
						setMode(mode === "plan" ? "act" : "plan");
						props.onToggleMode();
						break;
					case "auto-approve":
						setAutoApprove(!autoApprove);
						props.onToggleAutoApprove();
						break;
					case "compaction": {
						const nextMode = getNextCliCompactionMode(compactionMode);
						setCompactionMode(nextMode);
						props.onSetCompactionMode(nextMode);
						break;
					}
					case "verbose":
						config.verbose = !verbose;
						setVerbose(!verbose);
						break;
				}
				break;
			case "ext": {
				const action = resolveConfigItemSelectAction(row.item);
				if (isInlineConfigAction(action)) {
					void handleInlineToggle(row.item);
				} else {
					resolve(action);
				}
				break;
			}
			case "mcp-manager":
				resolve({ kind: "open-mcp" });
				break;
			case "tool-group":
				break;
		}
	};

	const handleToggleSelected = () => {
		const row = rows[selectedRowIdx];
		if (!row) return;
		if (row.kind === "toggle") {
			handleSelect();
			return;
		}
		if (!isToggleableRow(row)) return;
		const action = resolveConfigItemToggleAction(row.item);
		if (isInlineConfigAction(action)) {
			void handleInlineToggle(row.item);
		}
	};

	useDialogKeyboard((key) => {
		if (key.name === "escape") {
			dismiss();
			return;
		}
		if (key.name === "left" || key.name === "right") {
			const direction = key.name === "left" ? "left" : "right";
			setActiveTab((tab) => {
				const nextTab = getAdjacentConfigTab(tab, direction);
				return nextTab;
			});
			setNavPosition(0);
			return;
		}
		if (key.name === "up") {
			const nextNavPos =
				clampedNavPos > 0 ? clampedNavPos - 1 : navIndices.length - 1;
			setNavPosition(nextNavPos);
			return;
		}
		if (key.name === "down") {
			const nextNavPos =
				clampedNavPos < navIndices.length - 1 ? clampedNavPos + 1 : 0;
			setNavPosition(nextNavPos);
			return;
		}
		if (key.name === "space") {
			handleToggleSelected();
			return;
		}
		if (key.name === "return" || key.name === "tab") {
			handleSelect();
		}
	}, dialogId);

	const maxVisible = Math.max(5, height - 12);
	const win = getVisibleWindow(rows, selectedRowIdx, maxVisible);
	const aboveCount = win.startIndex;
	const belowCount = rows.length - win.startIndex - win.items.length;

	return (
		<box flexDirection="column" paddingX={1}>
			<text fg="cyan">
				<strong>Settings</strong>
			</text>

			<box flexDirection="row" flexWrap="wrap" paddingBottom={1}>
				{getConfigTabs().map((tab) => {
					const isActive = tab === activeTab;
					return (
						<box
							key={tab}
							height={1}
							backgroundColor={isActive ? palette.selection : undefined}
						>
							<text fg={isActive ? palette.textOnSelection : "gray"}>
								{` ${toTabLabel(tab)} `}
							</text>
						</box>
					);
				})}
			</box>

			{aboveCount > 0 && (
				<text fg="gray">
					{"▲ "}
					{aboveCount} more
				</text>
			)}

			{win.items.map((row, i) => {
				const absIdx = win.startIndex + i;
				const isSel = absIdx === selectedRowIdx;
				const pfx = isSel ? "▸ " : "  ";

				switch (row.kind) {
					case "spacer":
						return <text key={absIdx}> </text>;
					case "head":
						return (
							<text key={absIdx} fg="white">
								{" ".repeat(row.indent ?? 0)}
								{row.label}
							</text>
						);
					case "detail":
						return (
							<text key={absIdx} fg="gray">
								{"  "}
								{row.text}
							</text>
						);
					case "tool-group":
						return (
							<box
								key={absIdx}
								flexDirection="row"
								justifyContent="space-between"
							>
								<text fg="white">
									{"  "}
									{" ".repeat(row.indent ?? 0)}
									{row.label}
								</text>
								<text fg="gray">{row.rightLabel}</text>
							</box>
						);
					case "provider":
						return (
							<box
								key={absIdx}
								flexDirection="row"
								justifyContent="space-between"
							>
								<text fg={isSel ? "cyan" : undefined}>{pfx}Provider</text>
								<text fg="white">{props.providerDisplayName}</text>
							</box>
						);
					case "model":
						return (
							<box
								key={absIdx}
								flexDirection="row"
								justifyContent="space-between"
							>
								<text fg={isSel ? "cyan" : undefined}>{pfx}Model</text>
								<text fg="white">{displayName}</text>
							</box>
						);
					case "toggle": {
						let value: string;
						let valueColor: string;
						if (row.id === "mode") {
							value = mode === "plan" ? "Plan" : "Act";
							valueColor = getModeAccent(mode);
						} else if (row.id === "auto-approve") {
							value = autoApprove ? "● on" : "○ off";
							valueColor = autoApprove ? palette.success : "gray";
						} else if (row.id === "compaction") {
							value = formatCliCompactionMode(compactionMode);
							valueColor = COMPACTION_MODE_COLORS[compactionMode];
						} else {
							value = verbose ? "● on" : "○ off";
							valueColor = verbose ? palette.success : "gray";
						}
						return (
							<box
								key={absIdx}
								flexDirection="row"
								justifyContent="space-between"
							>
								<text fg={isSel ? "cyan" : undefined}>
									{pfx}
									{row.label}
								</text>
								<text fg={valueColor}>{value}</text>
							</box>
						);
					}
					case "ext": {
						const enabledState =
							row.item.enabledState ??
							(row.enabled === false ? "disabled" : "enabled");
						const isPending = togglingItemId === row.item.id;
						const enabledIcon =
							typeof row.enabled === "boolean"
								? isPending
									? "~ "
									: enabledState === "partial"
										? "◐ "
										: row.enabled
											? "● "
											: "○ "
								: "";
						const rightLabel = row.rightLabel ?? "";
						const toggleable = isToggleableConfigItem(row.item);
						const prefix = " ".repeat(row.indent ?? 0);
						const rowColor =
							toggleable && enabledState === "enabled"
								? palette.success
								: enabledState === "partial"
									? "yellow"
									: isSel
										? "cyan"
										: "gray";
						return (
							<box
								key={absIdx}
								flexDirection="row"
								justifyContent="space-between"
							>
								<text fg={rowColor}>
									{pfx}
									{prefix}
									{enabledIcon}
									{getConfigItemDisplayName(row.name)}
								</text>
								<text fg="gray">{rightLabel}</text>
							</box>
						);
					}
					case "mcp-manager":
						return (
							<text key={absIdx} fg={isSel ? "cyan" : "gray"}>
								{pfx}Manage MCP Servers...
							</text>
						);
					default:
						return null;
				}
			})}

			{belowCount > 0 && (
				<text fg="gray">
					{"▼ "}
					{belowCount} more
				</text>
			)}

			<text> </text>
			{toggleError && <text fg="red">{toggleError}</text>}
			<text fg="gray">
				<em>{togglingItemId ? "Applying settings" : getConfigFooterText()}</em>
			</text>
		</box>
	);
}
