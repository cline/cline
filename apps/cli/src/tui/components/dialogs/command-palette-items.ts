export type CommandPaletteAction =
	| "settings"
	| "change-model"
	| "change-provider"
	| "account"
	| "mcp"
	| "compact"
	| "skills"
	| "fork"
	| "undo"
	| "clear"
	| "history"
	| "help"
	| "quit";

export interface CommandPaletteResult {
	kind: "action";
	action: CommandPaletteAction;
}

export interface CommandPaletteItem {
	id: string;
	label: string;
	description: string;
	shortcut: string;
	keywords: string[];
	result: CommandPaletteResult;
}

const ACTION_ITEMS: Array<{
	action: CommandPaletteAction;
	label: string;
	shortcut: string;
	description: string;
	keywords: string[];
	requiresFork?: boolean;
}> = [
	{
		action: "settings",
		label: "Open Settings",
		shortcut: "Opt+S",
		description: "Review and edit CLI configuration",
		keywords: ["config", "preferences", "general", "tools"],
	},
	{
		action: "change-model",
		label: "Change Model",
		shortcut: "Opt+M",
		description: "Pick a different model for future requests",
		keywords: ["model", "provider", "llm", "reasoning", "thinking"],
	},
	{
		action: "change-provider",
		label: "Change Provider",
		shortcut: "Opt+P",
		description: "Switch provider and configure credentials",
		keywords: ["provider", "api key", "account", "auth"],
	},
	{
		action: "mcp",
		label: "Manage MCP Servers",
		shortcut: "Opt+C",
		description: "Enable, disable, or inspect MCP servers",
		keywords: ["mcp", "server", "tool", "toggle"],
	},
	{
		action: "account",
		label: "Open Account",
		shortcut: "Opt+A",
		description: "View or switch your Cline account",
		keywords: ["account", "login", "auth", "cline"],
	},
	{
		action: "compact",
		label: "Compact Context",
		shortcut: "Opt+X",
		description: "Compact context",
		keywords: ["compact", "context", "compress"],
	},
	{
		action: "skills",
		label: "Browse Skills",
		shortcut: "Opt+W",
		description: "Insert an installed skill or workflow command",
		keywords: ["skills", "workflows", "marketplace"],
	},
	{
		action: "fork",
		label: "Create Session Fork",
		shortcut: "Opt+F",
		description: "Branch the current conversation into a new session",
		keywords: ["fork", "session", "branch"],
		requiresFork: true,
	},
	{
		action: "undo",
		label: "Restore Checkpoint",
		shortcut: "Opt+U",
		description: "Return to an earlier checkpoint",
		keywords: ["undo", "checkpoint", "restore"],
	},
	{
		action: "clear",
		label: "Start New Session",
		shortcut: "Opt+L",
		description: "Clear the conversation and restart the session",
		keywords: ["clear", "new", "reset"],
	},
	{
		action: "history",
		label: "Session History",
		shortcut: "Opt+H",
		description: "Resume a previous session",
		keywords: ["history", "resume", "sessions"],
	},
	{
		action: "help",
		label: "Open Help",
		shortcut: "Opt+K",
		description: "Show CLI shortcuts and commands",
		keywords: ["help", "shortcuts", "commands"],
	},
	{
		action: "quit",
		label: "Exit Cline",
		shortcut: "Opt+Q",
		description: "Close the interactive CLI",
		keywords: ["quit", "exit"],
	},
];

function normalize(value: string): string {
	return value
		.toLowerCase()
		.replace(/[+-]/g, " ")
		.replace(/[^a-z0-9/ ]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function includesAllTokens(haystack: string, tokens: string[]): boolean {
	return tokens.every((token) => haystack.includes(token));
}

function scoreItem(item: CommandPaletteItem, query: string): number {
	const normalizedQuery = normalize(query.trim());
	if (!normalizedQuery) return 1;

	const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
	const label = normalize(item.label);
	const description = normalize(item.description);
	const keywordText = normalize(item.keywords.join(" "));
	const shortcut = normalize(item.shortcut);
	const searchText = `${label} ${description} ${keywordText} ${shortcut}`;

	if (!includesAllTokens(searchText, tokens)) return 0;
	if (label === normalizedQuery) return 120;
	if (label.startsWith(normalizedQuery)) return 100;
	if (label.includes(normalizedQuery)) return 75;
	if (shortcut.includes(normalizedQuery)) return 70;
	if (keywordText.includes(normalizedQuery)) return 60;
	if (description.includes(normalizedQuery)) return 45;
	return 20;
}

export function buildCommandPaletteItems(input: {
	canForkSession: boolean;
}): CommandPaletteItem[] {
	return ACTION_ITEMS.filter(
		(item) => !item.requiresFork || input.canForkSession,
	).map((item) => ({
		id: `action:${item.action}`,
		label: item.label,
		description: item.description,
		shortcut: item.shortcut,
		keywords: item.keywords,
		result: { kind: "action" as const, action: item.action },
	}));
}

export function filterCommandPaletteItems(
	items: CommandPaletteItem[],
	query: string,
): CommandPaletteItem[] {
	return items
		.map((item, index) => ({
			item,
			index,
			score: scoreItem(item, query),
		}))
		.filter((entry) => entry.score > 0)
		.sort((a, b) => {
			if (b.score !== a.score) return b.score - a.score;
			return a.index - b.index;
		})
		.map((entry) => entry.item);
}

export function findCommandPaletteShortcut(
	items: readonly CommandPaletteItem[],
	key: { name: string; meta: boolean; option?: boolean; shift: boolean },
): CommandPaletteItem | undefined {
	if (!key.meta && key.option !== true) return undefined;
	const keyName = key.name.toLowerCase();
	return items.find((item) => {
		const [, shortcutKey] = item.shortcut.toLowerCase().split("+");
		if (!shortcutKey) return false;
		return shortcutKey === keyName;
	});
}
