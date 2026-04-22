import { Box, Text } from "ink";
import React, { useMemo } from "react";
import type {
	InteractiveConfigData,
	InteractiveConfigItem,
	InteractiveConfigTab,
} from "../interactive-config";

export const CONFIG_TABS: InteractiveConfigTab[] = [
	"tools",
	"rules",
	"skills",
	"agents",
	"hooks",
	"plugins",
	"mcp",
];

const MAX_CONFIG_ITEMS_VISIBLE = 12;

type ConfigSection = {
	title: string;
	items: InteractiveConfigItem[];
};

export function toTabLabel(tab: InteractiveConfigTab): string {
	switch (tab) {
		case "tools":
			return "Tools";
		case "skills":
			return "Skills";
		case "rules":
			return "Rules";
		case "hooks":
			return "Hooks";
		case "agents":
			return "Agents";
		case "plugins":
			return "Plugins";
		case "mcp":
			return "MCP";
		default:
			return tab;
	}
}

function formatSeparator(char = "─", width?: number): string {
	const columns = width ?? process.stdout.columns ?? 80;
	return char.repeat(Math.max(10, columns));
}

function truncatePath(path: string, maxLength = 72, tail = false): string {
	if (path.length <= maxLength) {
		return path;
	}
	if (tail) {
		return `${path.slice(0, maxLength - 3)}...`;
	}
	return `...${path.slice(-(maxLength - 3))}`;
}

export interface VisibleWindow<T> {
	items: T[];
	startIndex: number;
}

export function getVisibleWindow<T>(
	items: T[],
	selectedIndex: number,
	maxVisible = MAX_CONFIG_ITEMS_VISIBLE,
): VisibleWindow<T> {
	if (items.length <= maxVisible) {
		return { items, startIndex: 0 };
	}
	const halfWindow = Math.floor(maxVisible / 2);
	let startIndex = Math.max(0, selectedIndex - halfWindow);
	const endIndex = Math.min(items.length, startIndex + maxVisible);
	if (endIndex - startIndex < maxVisible) {
		startIndex = Math.max(0, endIndex - maxVisible);
	}
	return { items: items.slice(startIndex, endIndex), startIndex };
}

function sortBySourceThenName(
	items: InteractiveConfigItem[],
): InteractiveConfigItem[] {
	const sourceRank = (source: InteractiveConfigItem["source"]): number => {
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
			default:
				return 5;
		}
	};

	return [...items].sort((a, b) => {
		if (a.source !== b.source) {
			return sourceRank(a.source) - sourceRank(b.source);
		}
		return a.name.localeCompare(b.name);
	});
}

export function resolveActiveConfigItems(
	configData: InteractiveConfigData,
	configTab: InteractiveConfigTab,
): InteractiveConfigItem[] {
	switch (configTab) {
		case "skills":
			return sortBySourceThenName([
				...configData.skills.map((item) => ({
					...item,
					description: item.description,
				})),
				...configData.workflows.map((item) => ({
					...item,
					description: item.description,
				})),
			]);
		case "rules":
			return sortBySourceThenName(configData.rules);
		case "hooks":
			return sortBySourceThenName(configData.hooks);
		case "agents":
			return sortBySourceThenName(configData.agents);
		case "plugins":
			return sortBySourceThenName(configData.plugins);
		case "mcp":
			return sortBySourceThenName(configData.mcp);
		case "tools":
			return sortBySourceThenName(configData.tools);
		default:
			return [];
	}
}

function buildSections(
	configTab: InteractiveConfigTab,
	items: InteractiveConfigItem[],
): ConfigSection[] {
	if (items.length === 0) {
		return [];
	}

	if (configTab === "hooks") {
		const groups = new Map<string, ConfigSection>();
		for (const item of items) {
			const title =
				item.source === "workspace"
					? "Workspace Hooks:"
					: item.source === "global"
						? "Global Hooks:"
						: `${item.source} Hooks:`;
			const section = groups.get(title) ?? { title, items: [] };
			section.items.push(item);
			groups.set(title, section);
		}
		return [...groups.values()];
	}

	if (configTab === "tools") {
		const groups = new Map<string, ConfigSection>();
		for (const item of items) {
			const title =
				item.source === "builtin"
					? "Builtin Tools:"
					: item.source === "workspace-plugin"
						? "Workspace Plugin Tools:"
						: item.source === "global-plugin"
							? "Global Plugin Tools:"
							: "Tools:";
			const section = groups.get(title) ?? { title, items: [] };
			section.items.push(item);
			groups.set(title, section);
		}
		return [...groups.values()];
	}

	if (configTab === "skills") {
		const groups = new Map<string, ConfigSection>();
		for (const item of items) {
			const isWorkflow =
				item.id === item.name.toLowerCase() || item.name.startsWith("/");
			const kindLabel = isWorkflow ? "Workflow" : "Skill";
			let sourceLabel: string;
			switch (item.source) {
				case "workspace":
					sourceLabel = "Workspace";
					break;
				case "global":
					sourceLabel = "Global";
					break;
				default:
					sourceLabel =
						item.source.charAt(0).toUpperCase() + item.source.slice(1);
					break;
			}
			const title = `${sourceLabel} ${kindLabel}s:`;
			const section = groups.get(title) ?? { title, items: [] };
			section.items.push(item);
			groups.set(title, section);
		}
		return [...groups.values()];
	}

	const groups = new Map<string, ConfigSection>();
	for (const item of items) {
		let sectionLabel: string;
		switch (item.source) {
			case "workspace":
				sectionLabel = "Workspace";
				break;
			case "global":
				sectionLabel = "Global";
				break;
			default:
				sectionLabel =
					item.source.charAt(0).toUpperCase() + item.source.slice(1);
				break;
		}
		const title = `${sectionLabel} ${toTabLabel(configTab)}:`;
		const section = groups.get(title) ?? { title, items: [] };
		section.items.push(item);
		groups.set(title, section);
	}
	return [...groups.values()];
}

function getStatusColor(item: InteractiveConfigItem): string | undefined {
	if (typeof item.enabled !== "boolean") {
		return undefined;
	}
	return item.enabled ? "green" : "red";
}

function renderConfigRow(
	item: InteractiveConfigItem,
	isSelected: boolean,
	indexKey: string,
): React.ReactElement {
	const statusColor = getStatusColor(item);
	const statusSymbol =
		typeof item.enabled === "boolean" ? (item.enabled ? "●" : "○") : "•";
	const title = [item.name, item.source].filter(Boolean).join(" · ");
	const detail = truncatePath(item.path, 56);

	return React.createElement(
		Box,
		{ flexDirection: "column", key: indexKey },
		React.createElement(
			Text,
			{ color: isSelected ? "cyan" : undefined },
			`${isSelected ? "❯ " : "  "}${statusSymbol} ${title}`,
		),
		React.createElement(
			Text,
			{ color: statusColor ?? "gray" },
			`    ${detail}`,
		),
	);
}

export interface ConfigViewProps {
	configTab: InteractiveConfigTab;
	configSelectedIndex: number;
	activeConfigItems: InteractiveConfigItem[];
	isLoadingConfig: boolean;
}

export function ConfigView(props: ConfigViewProps): React.ReactElement | null {
	const { configTab, configSelectedIndex, activeConfigItems, isLoadingConfig } =
		props;

	const visibleConfigItems = useMemo(
		() =>
			getVisibleWindow(
				activeConfigItems,
				Math.min(
					configSelectedIndex,
					Math.max(activeConfigItems.length - 1, 0),
				),
				MAX_CONFIG_ITEMS_VISIBLE,
			),
		[activeConfigItems, configSelectedIndex],
	);

	const visibleSections = useMemo(
		() => buildSections(configTab, visibleConfigItems.items),
		[configTab, visibleConfigItems.items],
	);
	const separator = formatSeparator();
	const listStart = visibleConfigItems.startIndex;
	const listEnd = listStart + visibleConfigItems.items.length;

	return React.createElement(
		Box,
		{
			flexDirection: "column",
		},
		React.createElement(
			Text,
			{ bold: true, color: "white" },
			"⚙ Cline Configuration",
		),
		React.createElement(Text, { color: "gray" }, separator),
		React.createElement(
			Box,
			{ marginBottom: 1 },
			...CONFIG_TABS.flatMap((tab, index) => [
				index > 0
					? React.createElement(
							Text,
							{ color: "gray", key: `${tab}:sep` },
							" │ ",
						)
					: null,
				React.createElement(
					Text,
					{
						bold: tab === configTab,
						color: tab === configTab ? "cyan" : "gray",
						key: tab,
					},
					tab === configTab ? `[${toTabLabel(tab)}]` : toTabLabel(tab),
				),
			]),
		),
		React.createElement(Text, { color: "gray" }, separator),
		isLoadingConfig
			? React.createElement(Text, { color: "gray" }, "Loading config...")
			: activeConfigItems.length === 0
				? React.createElement(
						Text,
						{ color: "gray" },
						`No ${toTabLabel(configTab).toLowerCase()} found.`,
					)
				: React.createElement(
						Box,
						{ flexDirection: "column" },
						...visibleSections.flatMap((section) => [
							React.createElement(
								Box,
								{ key: `${section.title}:header`, marginTop: 1 },
								React.createElement(
									Text,
									{ bold: true, color: "yellow" },
									section.title,
								),
							),
							...section.items.map((item) =>
								renderConfigRow(
									item,
									activeConfigItems[configSelectedIndex]?.id === item.id,
									`${section.title}:${item.id}`,
								),
							),
						]),
					),
		activeConfigItems.length > MAX_CONFIG_ITEMS_VISIBLE
			? React.createElement(
					Box,
					{ marginTop: 1 },
					React.createElement(
						Text,
						{ color: "gray" },
						`${listStart > 0 ? "↑ " : "  "}Showing ${listStart + 1}-${listEnd} of ${activeConfigItems.length}${listEnd < activeConfigItems.length ? " ↓" : "  "}`,
					),
				)
			: null,
		React.createElement(Text, { color: "gray" }, separator),
		React.createElement(
			Box,
			{ flexDirection: "column" },
			React.createElement(
				Text,
				{ color: "gray" },
				"↑/↓ or j/k Navigate • ←/→ tabs • 1-8 tabs • Enter Toggle • Esc Exit",
			),
		),
	);
}
