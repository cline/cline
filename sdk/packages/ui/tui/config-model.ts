import type { SlashCommand } from "./types";

/**
 * Plain data model for the interactive settings panel. Hosts assemble this
 * data (filesystem scans, plugin/MCP registries, tool catalogs) and hand it
 * to the UI through `loadConfigData`; the UI only renders and toggles it.
 */

export type InteractiveConfigTab =
	| "general"
	| "tools"
	| "workflows"
	| "agents"
	| "plugins"
	| "hooks"
	| "skills"
	| "rules"
	| "mcp";

export type InteractiveConfigItemKind =
	| "workflow"
	| "rule"
	| "skill"
	| "hook"
	| "agent"
	| "plugin"
	| "mcp"
	| "tool";

export interface InteractiveConfigItem {
	id: string;
	name: string;
	path: string;
	enabled?: boolean;
	kind: InteractiveConfigItemKind;
	enabledState?: "enabled" | "disabled" | "partial";
	toolNames?: string[];
	configKind?: "tool" | "plugin";
	pluginName?: string;
	pluginPath?: string;
	loadError?: string;
	loadErrorPhase?: "load" | "setup";
	source:
		| "global"
		| "workspace"
		| "builtin"
		| "global-plugin"
		| "workspace-plugin";
	description?: string;
}

export interface InteractiveConfigData {
	workflows: InteractiveConfigItem[];
	rules: InteractiveConfigItem[];
	skills: InteractiveConfigItem[];
	hooks: InteractiveConfigItem[];
	agents: InteractiveConfigItem[];
	plugins: InteractiveConfigItem[];
	mcp: InteractiveConfigItem[];
	tools: InteractiveConfigItem[];
	workflowSlashCommands: SlashCommand[];
	pluginDiagnosticsLoaded?: boolean;
}

export interface LoadInteractiveConfigDataOptions {
	includePluginTools?: boolean;
}

export function isToggleableInteractiveConfigItem(
	item: Pick<InteractiveConfigItem, "kind" | "source" | "pluginName">,
): boolean {
	if (item.kind === "mcp") {
		return !item.pluginName;
	}
	return (
		item.kind === "skill" ||
		item.kind === "plugin" ||
		item.source === "builtin" ||
		item.source === "workspace-plugin" ||
		item.source === "global-plugin"
	);
}
