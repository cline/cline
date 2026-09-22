import { statSync } from "node:fs";
import {
	type AgentExtensionCommand,
	createContributionRegistry,
	resolveAgentPluginPaths,
	resolveAndLoadAgentPlugins,
} from "@cline/core";
import type { AgentTool, Message } from "@cline/shared";

export type PluginSlashCommandResult = {
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
			commands: registry.getRegistrySnapshot().commands,
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
	const key = pluginPaths
		.map((path) => {
			try {
				return `${path}:${statSync(path).mtimeMs}`;
			} catch {
				return path;
			}
		})
		.join("\n");
	// Chain onto the previous host promise so concurrent callers serialize:
	// a stale host is shut down and replaced exactly once.
	const next = (
		hostsByWorkspace.get(workspacePath) ??
		Promise.resolve<PluginCommandHost | undefined>(undefined)
	)
		.catch(() => undefined)
		.then(async (host) => {
			if (host?.key === key) return host;
			await host?.shutdown?.().catch(() => {});
			return await loadPluginCommandHost(workspacePath, key);
		});
	hostsByWorkspace.set(workspacePath, next);
	return await next;
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
	if (!match) return undefined;
	const name = normalizeCommandName(match[1] ?? "");
	const host = await getPluginCommandHost(input.workspacePath);
	const command = host?.commands.find(
		(candidate) => normalizeCommandName(candidate.name) === name,
	);
	if (!command?.handler) return undefined;
	const result = await command.handler((match[2] ?? "").trim());
	const { reply, submitPrompt }: PluginSlashCommandResult =
		typeof result === "string" ? { reply: result } : (result ?? {});
	return {
		reply: reply?.trim() || undefined,
		submitPrompt: submitPrompt?.trim() || undefined,
	};
}
