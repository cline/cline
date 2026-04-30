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

export type ConfigAction =
	| { kind: "open-provider" }
	| { kind: "open-model" }
	| { kind: "toggle-item"; item: InteractiveConfigItem }
	| {
			kind: "ext-detail";
			name: string;
			path: string;
			source: string;
			enabled?: boolean;
	  }
	| { kind: "open-mcp" };

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

const CONFIG_TABS: InteractiveConfigTab[] = [
	"general",
	"mcp",
	"skills",
	"rules",
	"tools",
	"plugins",
	"agents",
	"hooks",
];

function toTabLabel(tab: InteractiveConfigTab): string {
	switch (tab) {
		case "general":
			return "General";
		case "tools":
			return "Tools";
		case "plugins":
			return "Plugins";
		case "agents":
			return "Agents";
		case "hooks":
			return "Hooks";
		case "skills":
			return "Skills";
		case "rules":
			return "Rules";
		case "mcp":
			return "MCP";
		case "workflows":
			return "Workflows";
	}
}

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

function resolveActiveConfigItems(
	configData: InteractiveConfigData,
	configTab: InteractiveConfigTab,
): InteractiveConfigItem[] {
	switch (configTab) {
		case "general":
			return [];
		case "tools":
			return sortBySourceThenName(configData.tools);
		case "plugins":
			return sortBySourceThenName(configData.plugins);
		case "agents":
			return sortBySourceThenName(configData.agents);
		case "hooks":
			return sortBySourceThenName(configData.hooks);
		case "skills":
			return sortBySourceThenName([
				...configData.workflows,
				...configData.skills,
			]);
		case "rules":
			return sortBySourceThenName(configData.rules);
		case "mcp":
			return sortBySourceThenName(configData.mcp);
		case "workflows":
			return sortBySourceThenName(configData.workflows);
	}
}

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
	onToggleMode: () => void;
	onToggleAutoApprove: () => void;
}

export function ConfigPanelContent(props: ConfigPanelProps) {
	const { resolve, dismiss, dialogId, config, configData } = props;
	const { height } = useTerminalDimensions();

	const [mode, setMode] = useState(props.currentMode);
	const [autoApprove, setAutoApprove] = useState(
		config.toolPolicies["*"]?.autoApprove !== false,
	);
	const [verbose, setVerbose] = useState(config.verbose);
	const [activeTab, setActiveTab] = useState<InteractiveConfigTab>("general");
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
				if (
					typeof row.enabled === "boolean" &&
					(row.source === "builtin" ||
						row.source === "workspace-plugin" ||
						row.source === "global-plugin")
				) {
					resolve({ kind: "toggle-item", item: row.item });
					break;
				}
				resolve({
					kind: "ext-detail",
					name: row.name,
					path: row.path,
					source: row.source,
					enabled: row.enabled,
				});
				break;
			case "mcp-manager":
				resolve({ kind: "open-mcp" });
				break;
		}
	};

	useDialogKeyboard((key) => {
		if (key.name === "escape") {
			dismiss();
			return;
		}
		if (key.name === "left" || key.name === "right") {
			setActiveTab((tab) => {
				const currentIndex = CONFIG_TABS.indexOf(tab);
				const delta = key.name === "left" ? -1 : 1;
				const nextIndex =
					(currentIndex + delta + CONFIG_TABS.length) % CONFIG_TABS.length;
				return CONFIG_TABS[nextIndex] ?? "general";
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
				{CONFIG_TABS.map((tab) => {
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
					case "ext":
						return (
							<box
								key={absIdx}
								flexDirection="row"
								justifyContent="space-between"
							>
								<text fg={isSel ? "cyan" : "gray"}>
									{pfx}
									{typeof row.enabled === "boolean"
										? row.enabled
											? "● "
											: "○ "
										: ""}
									{row.name}
								</text>
								<text fg={getSourceColor(row.source)}>{row.source}</text>
							</box>
						);
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
			<text fg="gray">
				<em>
					{"←/→ switch tabs, ↑/↓ navigate, Tab/Enter to select, Esc to close"}
				</em>
			</text>
		</box>
	);
}
