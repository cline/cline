import { formatUserCommandBlock } from "@clinebot/shared";
import type { InteractiveSlashCommand } from "../interactive-welcome";

export type SlashCommandSource =
	| "tui"
	| "runtime"
	| "plugin"
	| "skill"
	| "workflow";

export type SlashCommandExecution = "local" | "runtime" | "user-command";

export type LocalSlashCommandName =
	| "settings"
	| "config"
	| "mcp"
	| "account"
	| "model"
	| "compact"
	| "fork"
	| "undo"
	| "clear"
	| "history"
	| "quit"
	| "help";

export interface SlashCommandRegistryEntry {
	name: string;
	description: string;
	instructions: string;
	source: SlashCommandSource;
	kind?: InteractiveSlashCommand["kind"];
	execution: SlashCommandExecution;
	visible: boolean;
	selectable: boolean;
}

export interface SlashCommandRegistry {
	entries: SlashCommandRegistryEntry[];
	byName: Map<string, SlashCommandRegistryEntry>;
}

const TUI_LOCAL_COMMANDS: Array<{
	name: LocalSlashCommandName;
	description: string;
	visible?: boolean;
}> = [
	{
		name: "settings",
		description: "Modify agent configuration",
	},
	{
		name: "config",
		description: "Modify agent configuration",
		visible: false,
	},
	{
		name: "model",
		description: "Switch model or provider",
	},
	{
		name: "account",
		description: "View Cline account",
	},
	{
		name: "mcp",
		description: "Manage MCP servers",
	},
	{
		name: "compact",
		description: "Compact context",
	},
	{
		name: "fork",
		description: "Create a copy of the current session into a new session",
	},
	{
		name: "undo",
		description: "Restore to a previous checkpoint",
	},
	{
		name: "clear",
		description: "Start a new session",
	},
	{
		name: "history",
		description: "View session history",
	},
	{
		name: "help",
		description: "Show help",
	},
	{
		name: "quit",
		description: "Exit Cline",
	},
];

const SYSTEM_COMMAND_ORDER = [
	"settings",
	"model",
	"account",
	"mcp",
	"compact",
	"fork",
	"undo",
	"clear",
	"team",
	"history",
	"help",
	"quit",
] satisfies ReadonlyArray<LocalSlashCommandName | "team">;

const SYSTEM_COMMAND_PRIORITY = new Map<string, number>(
	SYSTEM_COMMAND_ORDER.map((name, index) => [name, index]),
);

function normalizeCommandName(name: string): string {
	return name.trim().replace(/^\/+/, "").toLowerCase();
}

function addEntry(
	byName: Map<string, SlashCommandRegistryEntry>,
	entry: SlashCommandRegistryEntry,
): void {
	const normalized = normalizeCommandName(entry.name);
	if (!normalized || byName.has(normalized)) {
		return;
	}
	byName.set(normalized, {
		...entry,
		name: normalized,
	});
}

function entryFromRuntimeCommand(
	command: InteractiveSlashCommand,
	source: "runtime" | "plugin" | "skill" | "workflow",
): SlashCommandRegistryEntry | undefined {
	const name = normalizeCommandName(command.name);
	if (!name) {
		return undefined;
	}
	const execution: SlashCommandExecution =
		command.kind === "skill" || command.kind === "workflow"
			? "user-command"
			: "runtime";
	return {
		name,
		description: command.description ?? "",
		instructions: command.instructions,
		source,
		kind: command.kind,
		execution,
		visible: true,
		selectable: true,
	};
}

export function buildSlashCommandRegistry(input: {
	workflowSlashCommands?: InteractiveSlashCommand[];
	additionalSlashCommands?: InteractiveSlashCommand[];
	canFork?: boolean;
	showClineAccountCommand?: boolean;
}): SlashCommandRegistry {
	const byName = new Map<string, SlashCommandRegistryEntry>();

	for (const command of TUI_LOCAL_COMMANDS) {
		if (command.name === "account" && input.showClineAccountCommand === false) {
			continue;
		}
		const isFork = command.name === "fork";
		const visible =
			(command.visible ?? true) && (!isFork || input.canFork === true);
		addEntry(byName, {
			name: command.name,
			description: command.description,
			instructions: "",
			source: "tui",
			execution: "local",
			visible,
			selectable: visible,
		});
	}

	for (const command of input.workflowSlashCommands ?? []) {
		const source =
			command.kind === "skill" || command.kind === "workflow"
				? command.kind
				: "runtime";
		const entry = entryFromRuntimeCommand(command, source);
		if (entry) {
			addEntry(byName, entry);
		}
	}

	for (const command of input.additionalSlashCommands ?? []) {
		const entry = entryFromRuntimeCommand(command, "plugin");
		if (entry) {
			addEntry(byName, entry);
		}
	}

	return {
		entries: [...byName.values()],
		byName,
	};
}

export function resolveSlashCommand(
	registry: SlashCommandRegistry,
	commandName: string,
): SlashCommandRegistryEntry | undefined {
	return registry.byName.get(normalizeCommandName(commandName));
}

const USER_COMMAND_SLASH_PATTERN = /(^|\s)\/([a-zA-Z0-9_.-]+)(?=\s|$)/g;

export function formatSlashCommandAutocompleteValue(
	entry: SlashCommandRegistryEntry,
): string {
	return `/${entry.name} `;
}

export function expandUserCommandPrompt(
	input: string,
	registry: SlashCommandRegistry,
): string {
	if (input.includes("<user_command")) {
		return input;
	}

	const expandedSlashCommands = input.replace(
		USER_COMMAND_SLASH_PATTERN,
		(match, prefix: string, name: string) => {
			const command = resolveSlashCommand(registry, name);
			if (command?.execution !== "user-command") {
				return match;
			}
			return `${prefix}${formatUserCommandBlock(command.instructions, command.name)}`;
		},
	);
	if (expandedSlashCommands !== input) {
		return expandedSlashCommands;
	}

	const match = /^\/([a-zA-Z0-9_.-]+)(\s+[\s\S]*)?$/.exec(input.trim());
	if (!match) {
		return input;
	}
	const command = resolveSlashCommand(registry, match[1] ?? "");
	if (!command || command.execution !== "user-command") {
		return input;
	}
	const rest = (match[2] ?? "").trim();
	const block = formatUserCommandBlock(command.instructions, command.name);
	return rest ? `${block} ${rest}` : block;
}

export function getVisibleSystemSlashCommands(
	registry: SlashCommandRegistry,
): SlashCommandRegistryEntry[] {
	const visible = registry.entries.filter(
		(entry) => entry.visible && entry.execution !== "user-command",
	);
	const priorityOf = (name: string) =>
		SYSTEM_COMMAND_PRIORITY.get(name) ?? SYSTEM_COMMAND_ORDER.length;
	return visible
		.map((entry, index) => ({ entry, index }))
		.sort((a, b) => {
			const pa = priorityOf(a.entry.name);
			const pb = priorityOf(b.entry.name);
			if (pa !== pb) return pa - pb;
			return a.index - b.index;
		})
		.map(({ entry }) => entry);
}

export function getVisibleUserSlashCommands(
	registry: SlashCommandRegistry,
): SlashCommandRegistryEntry[] {
	return registry.entries.filter(
		(entry) => entry.visible && entry.execution === "user-command",
	);
}
