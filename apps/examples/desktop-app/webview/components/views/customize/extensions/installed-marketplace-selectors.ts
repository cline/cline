import type {
	McpServer,
	PluginItem,
	UserInstructionListsResponse,
} from "@/lib/extension-inventory";
import type { MarketplaceLocalInstalledMetadata } from "../marketplace/installed-marketplace-types";
import { TRANSPORT_TYPE_LABELS } from "../mcp/mcp-types";
import type { CommandItem, ItemScope } from "./installed-inventory-selectors";
import {
	getLocalMarketplaceMatchValues,
	getPathScope,
	normalizePath,
} from "./installed-inventory-selectors";

/** Local identity and searchable metadata are shared by result models and cards. */
export function getInstalledCommands({
	workflows,
	skills,
	workspaceRoot,
}: Pick<
	UserInstructionListsResponse,
	"workflows" | "skills" | "workspaceRoot"
>): CommandItem[] {
	return [
		...workflows.map(
			(workflow): CommandItem => ({
				...workflow,
				type: "workflow",
				scope: getPathScope(workflow.path, workspaceRoot),
			}),
		),
		...skills.map(
			(skill): CommandItem => ({
				...skill,
				id: normalizePath(skill.path).toLowerCase(),
				type: "skill",
				scope: getPathScope(skill.path, workspaceRoot),
			}),
		),
	].sort((a, b) => a.name.localeCompare(b.name));
}

export function skillMarketplaceItem(
	item: CommandItem,
): MarketplaceLocalInstalledMetadata {
	return {
		key: `${item.type}:${item.path}`,
		kind: item.type,
		matchValues: getLocalMarketplaceMatchValues(item.id, item.name, item.path),
		searchText: [
			item.description ?? "",
			item.instructions,
			item.pluginName ?? "",
		],
	};
}

export function getScopedPlugins({
	plugins,
	workspaceRoot,
}: Pick<UserInstructionListsResponse, "plugins" | "workspaceRoot">): {
	plugin: PluginItem;
	scope: ItemScope;
}[] {
	const normalizedRoot = normalizePath(workspaceRoot);
	const scoped = plugins.map((plugin) => {
		const path = normalizePath(plugin.path);
		const project =
			plugin.source === "workspace-plugin" ||
			Boolean(
				normalizedRoot &&
					path.startsWith(`${normalizedRoot}/`) &&
					(path.includes("/.cline/plugins") ||
						path.includes("/.agents/plugins")),
			);
		return { plugin, scope: (project ? "Project" : "Global") as ItemScope };
	});
	return [
		...scoped.filter(({ scope }) => scope === "Global"),
		...scoped.filter(({ scope }) => scope === "Project"),
	];
}

export function pluginMarketplaceItem(
	plugin: PluginItem,
): MarketplaceLocalInstalledMetadata {
	return {
		key: plugin.path,
		matchValues: getLocalMarketplaceMatchValues(plugin.name, plugin.path),
		searchText: [plugin.id, plugin.description ?? ""],
	};
}

export function getInstalledMcpServers(
	servers: McpServer[],
	includeBuiltinItems = true,
) {
	return servers
		.filter((server) => includeBuiltinItems || server.source !== "builtin")
		.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

export function mcpMarketplaceItem(
	server: McpServer,
): MarketplaceLocalInstalledMetadata {
	return {
		key: server.name,
		matchValues: [server.name],
		searchText: [
			server.command ?? "",
			server.url ?? "",
			server.cwd ?? "",
			TRANSPORT_TYPE_LABELS[server.transportType],
		],
	};
}
