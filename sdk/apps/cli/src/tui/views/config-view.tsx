import { useTerminalDimensions } from "@opentui/react";
import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import { useMemo, useState } from "react";
import type {
	InteractiveConfigData,
	InteractiveConfigItem,
	InteractiveConfigTab,
} from "../../tui/interactive-config";
import type { Config } from "../../utils/types";
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
	resolveInitialConfigTab,
	toTabLabel,
} from "./config-view-helpers";

type ConfigRow =
	| { kind: "spacer" }
	| { kind: "head"; label: string }
	| { kind: "detail"; text: string }
	| { kind: "provider" }
	| { kind: "model" }
	| { kind: "toggle"; id: string; label: string }
	| {
			kind: "ext";
			name: string;
			path: string;
			source: string;
			enabled?: boolean;
			description?: string;
			item: InteractiveConfigItem;
	  }
	| { kind: "mcp-manager" };

function getSourceColor(source: string): string {
	return source === "workspace" || source === "workspace-plugin"
		? palette.success
		: source === "builtin"
			? "cyan"
			: "gray";
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

export interface ConfigPanelProps extends ChoiceContext<ConfigAction> {
	config: Config;
	configData: InteractiveConfigData;
	providerDisplayName: string;
	currentMode: string;
	initialTab?: InteractiveConfigTab;
	onActiveTabChange?: (tab: InteractiveConfigTab) => void;
	onToggleConfigItem?: (
		item: InteractiveConfigItem,
	) => Promise<InteractiveConfigData | undefined>;
	onToggleMode: () => void;
	onToggleAutoApprove: () => void;
}

export function ConfigPanelContent(props: ConfigPanelProps) {
	const { resolve, dismiss, dialogId, config } = props;
	const { height } = useTerminalDimensions();

	const [mode, setMode] = useState(props.currentMode);
	const [autoApprove, setAutoApprove] = useState(
		config.toolPolicies["*"]?.autoApprove !== false,
	);
	const [verbose, setVerbose] = useState(config.verbose);
	const [activeTab, setActiveTab] = useState<InteractiveConfigTab>(() =>
		resolveInitialConfigTab(props.initialTab),
	);
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

	const selectedRowIdx = navIndices[navPos] ?? 0;

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
					case "verbose":
						config.verbose = !verbose;
						setVerbose(!verbose);
						break;
				}
				break;
			case "ext":
				{
					const action = resolveConfigItemSelectAction(row.item);
					if (isInlineConfigAction(action)) {
						void handleInlineToggle(row.item);
					} else {
						resolve(action);
					}
				}
				break;
			case "mcp-manager":
				resolve({ kind: "open-mcp" });
				break;
		}
	};

	const handleToggleSelected = () => {
		const row = rows[selectedRowIdx];
		if (!row || !isToggleableRow(row)) return;
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
				props.onActiveTabChange?.(nextTab);
				return nextTab;
			});
			setNavPos(0);
			return;
		}
		if (key.name === "up") {
			setNavPos((p) => (p > 0 ? p - 1 : navIndices.length - 1));
			return;
		}
		if (key.name === "down") {
			setNavPos((p) => (p < navIndices.length - 1 ? p + 1 : 0));
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
						const stateLabel =
							typeof row.enabled === "boolean"
								? row.enabled
									? "Enabled"
									: "Disabled"
								: undefined;
						const rightLabel = stateLabel
							? `${stateLabel} · ${row.source}`
							: row.source;
						return (
							<box
								key={absIdx}
								flexDirection="row"
								justifyContent="space-between"
							>
								<text
									fg={
										isSel ? "cyan" : row.enabled === false ? "gray" : undefined
									}
								>
									{pfx}
									{typeof row.enabled === "boolean"
										? row.enabled
											? "● "
											: "○ "
										: ""}
									{getConfigItemDisplayName(row.name)}
								</text>
								<text
									fg={
										row.enabled === false ? "gray" : getSourceColor(row.source)
									}
								>
									{rightLabel}
								</text>
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
				<em>{getConfigFooterText()}</em>
			</text>
		</box>
	);
}
