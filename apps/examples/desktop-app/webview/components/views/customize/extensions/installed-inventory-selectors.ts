import type {
	HookItem,
	RuleItem,
	ToolItem,
	UserInstructionListsResponse,
} from "@/lib/extension-inventory";

export type ItemScope = "Global" | "Project";

export type CommandItem = {
	id: string;
	type: "workflow" | "skill";
	name: string;
	description?: string;
	instructions: string;
	enabled?: boolean;
	path: string;
	scope: ItemScope;
	agentPlugin?: boolean;
	pluginName?: string;
};

type InstalledInventoryOptions = {
	searchQuery?: string;
	includeBuiltinItems?: boolean;
};

export function normalizePath(path: string): string {
	return path.replaceAll("\\", "/");
}

export function getPathScope(path: string, workspaceRoot: string): ItemScope {
	const normalizedRoot = normalizePath(workspaceRoot);
	const normalized = normalizePath(path);
	return normalizedRoot && normalized.startsWith(`${normalizedRoot}/`)
		? "Project"
		: "Global";
}

export function matchesSearchQuery(
	query: string,
	...values: Array<string | undefined>
): boolean {
	return !query || values.some((value) => value?.toLowerCase().includes(query));
}

export function toolMatchesQuery(
	tool: ToolItem,
	normalizedQuery: string,
): boolean {
	return matchesSearchQuery(
		normalizedQuery,
		tool.id,
		tool.name,
		tool.description,
		tool.pluginName,
		tool.path,
		...(tool.headlessToolNames ?? []),
	);
}

export function getLocalMarketplaceMatchValues(
	...values: Array<string | undefined>
): string[] {
	const matchValues = new Set<string>();
	for (const value of values) {
		const normalized = value?.trim().replaceAll("\\", "/");
		if (!normalized) continue;
		matchValues.add(normalized);
		const segments = normalized.split("/").filter(Boolean);
		for (const segment of segments) {
			matchValues.add(segment.replace(/\.[^.]+$/, ""));
		}
		for (let index = 0; index < segments.length - 1; index += 1) {
			matchValues.add(`${segments[index]}/${segments[index + 1]}`);
		}
	}
	return [...matchValues];
}

/** The same ordered result model drives the parent count and rendered rule cards. */
export function selectInstalledRules(
	{
		rules,
		workspaceRoot,
	}: Pick<UserInstructionListsResponse, "rules" | "workspaceRoot">,
	{
		searchQuery = "",
		includeBuiltinItems = true,
	}: InstalledInventoryOptions = {},
): Array<{ rule: RuleItem; scope: ItemScope }> {
	const query = searchQuery.trim().toLowerCase();
	const normalizedRoot = normalizePath(workspaceRoot).replace(/\/+$/, "");
	const workspaceRuleRoots = workspaceRoot
		? [`${normalizedRoot}/.clinerules`, `${normalizedRoot}/.cline/rules`]
		: [];
	const workspaceAgentsFile = workspaceRoot
		? `${normalizedRoot}/AGENTS.md`
		: null;
	const project: RuleItem[] = [];
	const global: RuleItem[] = [];
	for (const rule of rules) {
		if (!includeBuiltinItems && rule.source === "builtin") continue;
		const path = normalizePath(rule.path);
		// Only the workspace's AGENTS.md and rule roots are local. Equality
		// also covers single-file rules; nested lookalike roots remain global.
		if (
			path === workspaceAgentsFile ||
			workspaceRuleRoots.some(
				(root) => path === root || path.startsWith(`${root}/`),
			)
		) {
			project.push(rule);
		} else {
			global.push(rule);
		}
	}
	return [
		...global.map((rule) => ({ rule, scope: "Global" as const })),
		...project.map((rule) => ({ rule, scope: "Project" as const })),
	].filter(({ rule }) =>
		matchesSearchQuery(query, rule.name, rule.instructions, rule.path),
	);
}

export function selectInstalledHooks(
	{
		hooks,
		workspaceRoot,
	}: Pick<UserInstructionListsResponse, "hooks" | "workspaceRoot">,
	{
		searchQuery = "",
		includeBuiltinItems = true,
	}: InstalledInventoryOptions = {},
): Array<{ hook: HookItem; scope: ItemScope }> {
	const query = searchQuery.trim().toLowerCase();
	const normalizedRoot = normalizePath(workspaceRoot);
	const project: HookItem[] = [];
	const global: HookItem[] = [];
	for (const hook of hooks) {
		if (!includeBuiltinItems && hook.source === "builtin") continue;
		const path = normalizePath(hook.path);
		if (
			normalizedRoot &&
			path.startsWith(`${normalizedRoot}/`) &&
			path.includes("/.clinerules/hooks")
		) {
			project.push(hook);
		} else {
			global.push(hook);
		}
	}
	return [
		...global.map((hook) => ({ hook, scope: "Global" as const })),
		...project.map((hook) => ({ hook, scope: "Project" as const })),
	].filter(({ hook }) =>
		matchesSearchQuery(query, hook.fileName, hook.hookEventName, hook.path),
	);
}

export function selectInstalledTools(
	{ tools }: Pick<UserInstructionListsResponse, "tools">,
	{
		searchQuery = "",
		includeBuiltinItems = true,
	}: InstalledInventoryOptions = {},
) {
	const query = searchQuery.trim().toLowerCase();
	const builtinTools = tools
		.filter((tool) => includeBuiltinItems && tool.source === "builtin")
		.sort((a, b) => a.name.localeCompare(b.name));
	const pluginTools = tools
		.filter((tool) => tool.source !== "builtin")
		.sort((a, b) => a.name.localeCompare(b.name));
	return {
		builtinTools,
		pluginTools,
		filteredBuiltinTools: builtinTools.filter((tool) =>
			toolMatchesQuery(tool, query),
		),
		filteredPluginTools: pluginTools.filter((tool) =>
			toolMatchesQuery(tool, query),
		),
	};
}
