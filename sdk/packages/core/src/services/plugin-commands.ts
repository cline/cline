import { statSync } from "node:fs";
import {
	type AgentExtensionCommand,
	type AgentExtensionCommandResult,
	type AgentTool,
	type BasicLogger,
	createContributionRegistry,
	type Message,
} from "@cline/shared";
import {
	resolveAgentPluginPaths,
	resolveAndLoadAgentPlugins,
} from "../extensions/plugin/plugin-config-loader";

export interface PluginSlashCommand {
	/** Normalized token: lowercase, no leading slash. */
	name: string;
	description?: string;
}

export interface PluginCommandResult {
	reply?: string;
	submitPrompt?: string;
}

/**
 * Executes plugin-registered slash commands (`api.registerCommand`) for one
 * workspace. Plugins are loaded on first use and kept alive so repeated
 * commands answer instantly; the loaded set is refreshed when plugin module
 * paths or mtimes change (installs, updates, toggles).
 */
export interface PluginCommandService {
	listCommands(): Promise<PluginSlashCommand[]>;
	/** Runs `/name input`. Resolves undefined when no plugin declares `name`. */
	run(name: string, input: string): Promise<PluginCommandResult | undefined>;
	shutdown(): Promise<void>;
}

type LoadedHost = {
	key: string;
	commands: AgentExtensionCommand[];
	shutdown?: () => Promise<void>;
	/** Set when this entry records a failed load; retried after a short delay. */
	failedAt?: number;
};

// A failed load may be transient (sandbox startup timeout, I/O hiccup), so
// remember it only briefly instead of until the plugin set changes.
const FAILED_LOAD_RETRY_MS = 30_000;

export function normalizePluginCommandName(name: string): string {
	return name.trim().replace(/^\/+/, "").toLowerCase();
}

function normalizePluginCommandResult(
	result: AgentExtensionCommandResult | undefined,
): PluginCommandResult {
	const { reply, submitPrompt }: PluginCommandResult =
		typeof result === "string" ? { reply: result } : (result ?? {});
	return {
		reply: reply?.trim() || undefined,
		submitPrompt: submitPrompt?.trim() || undefined,
	};
}

async function loadHost(
	options: { cwd: string; workspacePath?: string },
	key: string,
): Promise<LoadedHost> {
	const loaded = await resolveAndLoadAgentPlugins(options);
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

export function createPluginCommandService(options: {
	cwd: string;
	workspacePath?: string;
	logger?: BasicLogger;
}): PluginCommandService {
	const loadOptions = {
		cwd: options.cwd,
		workspacePath: options.workspacePath ?? options.cwd,
	};
	let current: Promise<LoadedHost | undefined> = Promise.resolve(undefined);

	const ensureHost = (): Promise<LoadedHost | undefined> => {
		const pluginPaths = resolveAgentPluginPaths(loadOptions);
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
		current = current
			.catch(() => undefined)
			.then(async (host) => {
				if (
					host?.key === key &&
					(host.failedAt === undefined ||
						Date.now() - host.failedAt < FAILED_LOAD_RETRY_MS)
				) {
					return host;
				}
				await host?.shutdown?.().catch(() => {});
				if (pluginPaths.length === 0) return undefined;
				try {
					return await loadHost(loadOptions, key);
				} catch (error) {
					// A broken plugin must not block slash commands (the prompt may
					// be a skill or workflow). Remember the failure so a broken
					// plugin does not cost a sandbox spawn on every prompt.
					options.logger?.error?.(
						"plugin command loading failed; continuing without plugin commands",
						{ error },
					);
					return { key, commands: [], failedAt: Date.now() };
				}
			});
		return current;
	};

	return {
		async listCommands() {
			const host = await ensureHost();
			return (host?.commands ?? []).map((command) => ({
				name: normalizePluginCommandName(command.name),
				description: command.description,
			}));
		},
		async run(name, input) {
			const normalized = normalizePluginCommandName(name);
			const command = (await ensureHost())?.commands.find(
				(candidate) =>
					normalizePluginCommandName(candidate.name) === normalized,
			);
			if (!command?.handler) return undefined;
			return normalizePluginCommandResult(await command.handler(input.trim()));
		},
		async shutdown() {
			const host = await current.catch(() => undefined);
			current = Promise.resolve(undefined);
			await host?.shutdown?.().catch(() => {});
		},
	};
}
