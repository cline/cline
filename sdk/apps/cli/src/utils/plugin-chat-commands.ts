import {
	type AgentExtensionCommand,
	type BasicLogger,
	createContributionRegistry,
	resolveAndLoadAgentPlugins,
} from "@cline/core";
import type { AgentTool, Message } from "@cline/shared";
import {
	type ChatCommandDefinition,
	type ChatCommandHost,
	chatCommandHost,
} from "./chat-commands";

export interface PluginSlashCommand {
	name: string;
	description?: string;
}

export interface WorkspaceChatCommandHostResult {
	host: ChatCommandHost;
	/** Plugin-registered commands surfaced as slash commands for TUI autocomplete. */
	pluginSlashCommands: PluginSlashCommand[];
}

function normalizeCommandName(name: string): string {
	const trimmed = name.trim();
	if (!trimmed) {
		return trimmed;
	}
	return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function createPluginCommandDefinition(
	command: AgentExtensionCommand,
): ChatCommandDefinition | undefined {
	if (typeof command.handler !== "function") {
		return undefined;
	}
	const normalizedName = normalizeCommandName(command.name);
	if (!normalizedName) {
		return undefined;
	}
	return {
		names: [normalizedName.toLowerCase()],
		run: async ({ args }, context) => {
			const result = await command.handler?.(args.join(" "));
			if (typeof result === "string" && result.trim()) {
				await context.reply(result);
			}
		},
	};
}

export async function createWorkspaceChatCommandHost(input: {
	cwd: string;
	workspaceRoot?: string;
	logger?: BasicLogger;
}): Promise<WorkspaceChatCommandHostResult> {
	const workspaceRoot = input.workspaceRoot?.trim() || input.cwd;
	let loaded: Awaited<ReturnType<typeof resolveAndLoadAgentPlugins>>;
	try {
		loaded = await resolveAndLoadAgentPlugins({
			cwd: input.cwd,
			workspacePath: workspaceRoot,
			mode: "in_process",
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		input.logger?.log(
			`plugin command loading failed; continuing without plugin commands (${message})`,
		);
		return { host: chatCommandHost, pluginSlashCommands: [] };
	}
	if (!loaded.extensions.length) {
		return { host: chatCommandHost, pluginSlashCommands: [] };
	}

	const registry = createContributionRegistry<
		(typeof loaded.extensions)[number],
		AgentTool,
		Message[]
	>({
		extensions: loaded.extensions,
	});
	try {
		await registry.initialize();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		input.logger?.log(
			`plugin command registry initialization failed; continuing without plugin commands (${message})`,
		);
		return { host: chatCommandHost, pluginSlashCommands: [] };
	}

	const host = chatCommandHost.clone();
	const pluginSlashCommands: PluginSlashCommand[] = [];
	for (const command of registry.getRegistrySnapshot().commands) {
		const definition = createPluginCommandDefinition(command);
		if (definition) {
			host.register("command", definition);
			// Use the same normalized+lowercased name so TUI autocomplete matches the handler key.
			const normalizedName = definition.names[0]; // already lowercased, slash-prefixed
			pluginSlashCommands.push({
				name: normalizedName.startsWith("/")
					? normalizedName.slice(1)
					: normalizedName,
				description: command.description,
			});
		}
	}
	return { host, pluginSlashCommands };
}
