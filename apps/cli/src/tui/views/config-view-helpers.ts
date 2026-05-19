import type {
	InteractiveConfigData,
	InteractiveConfigItem,
	InteractiveConfigTab,
} from "../../tui/interactive-config";
import { isToggleableInteractiveConfigItem } from "../../tui/interactive-config";

export type ConfigAction =
	| { kind: "open-provider" }
	| { kind: "open-model" }
	| { kind: "toggle-item"; item: InteractiveConfigItem }
	| {
			kind: "ext-detail";
			item: InteractiveConfigItem;
	  }
	| { kind: "open-mcp" };

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

export function getConfigTabs(): InteractiveConfigTab[] {
	return CONFIG_TABS;
}

export function resolveInitialConfigTab(
	tab: InteractiveConfigTab | undefined,
): InteractiveConfigTab {
	return tab && CONFIG_TABS.includes(tab) ? tab : "general";
}

export function getAdjacentConfigTab(
	currentTab: InteractiveConfigTab,
	direction: "left" | "right",
): InteractiveConfigTab {
	const currentIndex = CONFIG_TABS.indexOf(currentTab);
	const safeIndex = currentIndex >= 0 ? currentIndex : 0;
	const delta = direction === "left" ? -1 : 1;
	const nextIndex =
		(safeIndex + delta + CONFIG_TABS.length) % CONFIG_TABS.length;
	return CONFIG_TABS[nextIndex] ?? "general";
}

export function toTabLabel(tab: InteractiveConfigTab): string {
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

export function resolveActiveConfigItems(
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

export function isToggleableConfigItem(item: InteractiveConfigItem): boolean {
	return isToggleableInteractiveConfigItem(item);
}

export function resolveConfigItemSelectAction(
	item: InteractiveConfigItem,
): ConfigAction {
	if (
		typeof item.enabled === "boolean" &&
		item.kind !== "skill" &&
		isToggleableConfigItem(item)
	) {
		return { kind: "toggle-item", item };
	}

	return {
		kind: "ext-detail",
		item,
	};
}

export function resolveConfigItemToggleAction(
	item: InteractiveConfigItem,
): ConfigAction | undefined {
	if (typeof item.enabled !== "boolean" || !isToggleableConfigItem(item)) {
		return undefined;
	}
	return { kind: "toggle-item", item };
}

export function isInlineConfigAction(
	action: ConfigAction | undefined,
): boolean {
	return action?.kind === "toggle-item";
}

export function getConfigFooterText(): string {
	return "←/→ switch tabs, ↑/↓ navigate, Tab/Enter select, Space toggle, Esc close";
}

export function getConfigItemDisplayName(name: string): string {
	return name;
}
