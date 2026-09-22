import { stat } from "node:fs/promises";
import {
	type AgentExtensionCommand,
	type AgentExtensionCommandResult,
	createContributionRegistry,
	resolveAgentPluginPaths,
	resolveAndLoadAgentPlugins,
} from "@cline/core";
import type { AgentTool, Message } from "@cline/shared";

export type PluginSlashCommandResult = {
	name: string;
	reply?: string;
	submitPrompt?: string;
};

type PluginCommandHost = {
	key: string;
	commands: AgentExtensionCommand[];
	shutdown?: () => Promise<void>;
};

// Loaded plugin command hosts by workspace. Like the CLI's interactive
// session, the sandboxes stay alive so repeated commands answer instantly;
// the key tracks the plugin set so installs, updates, and toggles reload it.
const hostsByWorkspace = new Map<string, Promise<PluginCommandHost>>();

function normalizeCommandName(name: string): string {
	return name.trim().replace(/^\/+/, "").toLowerCase();
}

function normalizeCommandResult(
	name: string,
	result: AgentExtensionCommandResult | undefined,
): PluginSlashCommandResult {
	if (typeof result === "string") {
		const reply = result.trim();
		return reply ? { name, reply } : { name };
	}
	if (!result || typeof result !== "object") {
		return { name };
	}
	const reply = result.reply?.trim();
	const submitPrompt = result.submitPrompt?.trim();
	return {
		name,
		...(reply ? { reply } : {}),
		...(submitPrompt ? { submitPrompt } : {}),
	};
}

async function pluginSetKey(pluginPaths: string[]): Promise<string> {
	return (
		await Promise.all(
			pluginPaths.map(async (pluginPath) => {
				try {
					const stats = await stat(pluginPath);
					return `${pluginPath}:${stats.mtimeMs}:${stats.size}`;
				} catch {
					return `${pluginPath}:missing`;
				}
			}),
		)
	).join("\n");
}

async function loadPluginCommandHost(
	workspacePath: string,
	key: string,
): Promise<PluginCommandHost> {
	const loaded = await resolveAndLoadAgentPlugins({
		cwd: workspacePath,
		workspacePath,
	});
	try {
		const registry = createContributionRegistry<
			(typeof loaded.extensions)[number],
			AgentTool,
			Message[]
		>({ extensions: loaded.extensions });
		await registry.initialize();
		return {
			key,
			commands: registry
				.getRegistrySnapshot()
				.commands.filter((command) => typeof command.handler === "function"),
			shutdown: loaded.shutdown,
		};
	} catch (error) {
		await loaded.shutdown?.().catch(() => {});
		throw error;
	}
}

async function getPluginCommandHost(
	workspacePath: string,
): Promise<PluginCommandHost | undefined> {
	const pluginPaths = resolveAgentPluginPaths({
		cwd: workspacePath,
		workspacePath,
	});
	if (pluginPaths.length === 0) return undefined;
	const key = await pluginSetKey(pluginPaths);
	const cached = hostsByWorkspace.get(workspacePath);
	if (cached) {
		const host = await cached.catch(() => undefined);
		if (host?.key === key) return host;
		hostsByWorkspace.delete(workspacePath);
		await host?.shutdown?.().catch(() => {});
	}
	const loading = loadPluginCommandHost(workspacePath, key);
	hostsByWorkspace.set(workspacePath, loading);
	loading.catch(() => {
		if (hostsByWorkspace.get(workspacePath) === loading) {
			hostsByWorkspace.delete(workspacePath);
		}
	});
	return await loading;
}

/**
 * Run a plugin-registered slash command (`api.registerCommand`) for the
 * leading `/name` token of a prompt. Returns undefined when no enabled plugin
 * declares the command so the prompt continues through the normal path.
 */
export async function runPluginSlashCommand(input: {
	workspacePath: string;
	prompt: string;
}): Promise<PluginSlashCommandResult | undefined> {
	const match = input.prompt.match(/^\/(\S+)([\s\S]*)$/);
	const name = match?.[1] ? normalizeCommandName(match[1]) : "";
	if (!name) return undefined;
	const host = await getPluginCommandHost(input.workspacePath);
	const command = host?.commands.find(
		(candidate) => normalizeCommandName(candidate.name) === name,
	);
	if (!command?.handler) return undefined;
	return normalizeCommandResult(
		name,
		await command.handler((match?.[2] ?? "").trim()),
	);
}
