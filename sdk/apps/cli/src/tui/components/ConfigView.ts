import { Box, Text } from "ink";
import React, { useMemo } from "react";
import type {
	InteractiveConfigData,
	InteractiveConfigItem,
	InteractiveConfigTab,
} from "../../runtime/interactive-config";

export const CONFIG_TABS: InteractiveConfigTab[] = [
	"tools",
	"plugins",
	"agents",
	"hooks",
	"skills",
	"rules",
	"mcp",
];

const MAX_CONFIG_ITEMS_VISIBLE = 12;
const MAX_MENU_ITEMS_VISIBLE = 5;

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
	}
}

function truncatePath(path: string, maxLength = 70): string {
	if (path.length <= maxLength) {
		return path;
	}
	return `...${path.slice(-(maxLength - 3))}`;
}

export function getVisibleWindow<T>(
	items: T[],
	selectedIndex: number,
	maxVisible = MAX_MENU_ITEMS_VISIBLE,
): { items: T[]; startIndex: number } {
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

export function resolveActiveConfigItems(
	configData: InteractiveConfigData,
	configTab: InteractiveConfigTab,
): InteractiveConfigItem[] {
	switch (configTab) {
		case "skills":
			return [...configData.workflows, ...configData.skills].sort((a, b) => {
				if (a.source !== b.source) {
					return a.source === "workspace" ? -1 : 1;
				}
				return a.name.localeCompare(b.name);
			});
		case "rules":
			return configData.rules;
		case "hooks":
			return configData.hooks;
		case "agents":
			return configData.agents;
		case "plugins":
			return configData.plugins;
		case "mcp":
			return configData.mcp;
		case "tools":
			return configData.tools;
	}
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

	const renderConfigItems = isLoadingConfig
		? React.createElement(Text, { color: "gray" }, "Loading config...")
		: activeConfigItems.length === 0
			? React.createElement(
					Text,
					{ color: "gray" },
					`No ${toTabLabel(configTab).toLowerCase()} found.`,
				)
			: visibleConfigItems.items.map((item, index) => {
					const absoluteIndex = visibleConfigItems.startIndex + index;
					const selected = absoluteIndex === configSelectedIndex;
					const prefix = selected ? "❯" : " ";
					const enabledTag =
						typeof item.enabled === "boolean"
							? item.enabled
								? "enabled"
								: "disabled"
							: "";
					const details = [item.source, enabledTag, truncatePath(item.path, 42)]
						.filter((value) => value.length > 0)
						.join(" · ");
					return React.createElement(
						Box,
						{
							flexDirection: "column",
							key: `${item.id}:${absoluteIndex}`,
						},
						React.createElement(
							Text,
							{ color: selected ? "blue" : undefined },
							`${prefix} ${item.name}`,
						),
						React.createElement(Text, { color: "gray" }, `  ${details}`),
					);
				});

	return React.createElement(
		Box,
		{
			flexDirection: "column",
			borderStyle: "round",
			paddingX: 1,
			marginBottom: 1,
		},
		React.createElement(Text, { color: "cyan" }, "Configuration"),
		React.createElement(
			Box,
			{ marginBottom: 1, gap: 1 },
			CONFIG_TABS.map((tab) =>
				React.createElement(
					Text,
					{
						key: tab,
						color: tab === configTab ? "blue" : "gray",
						bold: tab === configTab,
					},
					tab === configTab ? `[${toTabLabel(tab)}]` : toTabLabel(tab),
				),
			),
		),
		renderConfigItems,
		activeConfigItems.length >
			visibleConfigItems.startIndex + visibleConfigItems.items.length
			? React.createElement(Text, { color: "gray" }, "  ▼")
			: null,
	);
}
