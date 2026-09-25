import { existsSync, type FSWatcher, statSync, watch } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import {
	type AgentExtensionCommand,
	type AgentTool,
	type BasicLogger,
	createContributionRegistry,
	type Message,
} from "@cline/shared";
import { resolveGlobalSettingsPath } from "@cline/shared/storage";
import {
	resolveAndLoadAgentPlugins,
	resolvePluginConfigSearchPaths,
} from "../extensions/plugin/plugin-config-loader";
import {
	executePluginCommand,
	listPluginCommands,
	type PluginCommandCatalog,
	type PluginCommandsApi,
	type PluginCommandTarget,
} from "./plugin-command-api";

type LoadedPlugins = Awaited<ReturnType<typeof resolveAndLoadAgentPlugins>>;
type Entry = {
	workspacePath: string;
	catalog: PluginCommandCatalog;
	commands: AgentExtensionCommand[];
	loaded?: LoadedPlugins;
	pending?: Promise<void>;
	dirty: boolean;
	retryCount: number;
	timer?: ReturnType<typeof setTimeout>;
	watchers: FSWatcher[];
	/** Serializes execution with reload/disposal so a handler cannot lose its sandbox. */
	tail: Promise<unknown>;
};

/** Runtime-owned workspace catalogs. Session execution uses the session registry instead. */
export class PluginCommandManager implements PluginCommandsApi {
	private readonly entries = new Map<string, Entry>();
	private readonly listeners = new Set<
		(catalog: PluginCommandCatalog) => void
	>();
	private disposed = false;
	constructor(
		private readonly options: {
			logger?: BasicLogger;
			load?: typeof resolveAndLoadAgentPlugins;
			retryDelayMs?: number;
		} = {},
	) {}

	subscribe = (
		listener: (catalog: PluginCommandCatalog) => void,
	): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	private entry(target: PluginCommandTarget): Entry {
		if (this.disposed) throw new Error("Plugin command manager is disposed");
		const workspacePath = resolve(target.workspacePath);
		let entry = this.entries.get(workspacePath);
		if (!entry) {
			entry = {
				workspacePath,
				catalog: { workspacePath, status: "ready", commands: [] },
				commands: [],
				dirty: true,
				retryCount: 0,
				watchers: [],
				tail: Promise.resolve(),
			};
			this.entries.set(workspacePath, entry);
		}
		return entry;
	}
	private schedule(entry: Entry, delay: number): void {
		if (this.disposed) return;
		clearTimeout(entry.timer);
		entry.timer = setTimeout(() => {
			entry.dirty = true;
			void this.refresh(entry);
		}, delay);
		entry.timer.unref?.();
	}
	private watch(entry: Entry): void {
		for (const watcher of entry.watchers) watcher.close();
		entry.watchers = [];
		const settings = resolveGlobalSettingsPath();
		const roots = new Set([
			...resolvePluginConfigSearchPaths(entry.workspacePath),
			...(entry.loaded?.pluginPaths ?? []).map(dirname),
			settings,
		]);
		for (const root of roots) {
			let directory = root === settings ? dirname(root) : root;
			while (!existsSync(directory) && dirname(directory) !== directory)
				directory = dirname(directory);
			try {
				const recursive =
					directory === root && statSync(directory).isDirectory();
				const watcher = watch(
					directory,
					{ recursive, persistent: false },
					(_event, file) => {
						const changed = file ? resolve(directory, String(file)) : directory;
						if (String(file).split(/[\\/]/).includes("node_modules")) return;
						if (
							changed !== root &&
							!changed.startsWith(`${root}${sep}`) &&
							!root.startsWith(`${changed}${sep}`)
						)
							return;
						entry.dirty = true;
						this.schedule(entry, 100);
					},
				);
				watcher.on("error", () => this.schedule(entry, 1000));
				entry.watchers.push(watcher);
			} catch (error) {
				this.options.logger?.debug?.("Plugin command watcher unavailable", {
					directory,
					error,
				});
			}
		}
	}
	private refresh(entry: Entry): Promise<void> {
		if (entry.pending) return entry.pending;
		if (!entry.dirty || this.disposed) return Promise.resolve();
		entry.dirty = false;
		entry.pending = entry.tail
			.then(async () => {
				if (this.disposed) return;
				await entry.loaded?.shutdown?.().catch(() => {});
				entry.loaded = undefined;
				entry.commands = [];
				try {
					const loaded = await (
						this.options.load ?? resolveAndLoadAgentPlugins
					)({ cwd: entry.workspacePath, workspacePath: entry.workspacePath });
					entry.loaded = loaded;
					const error =
						loaded.failures.map((f) => f.message).join("; ") || undefined;
					const registry = createContributionRegistry<
						(typeof loaded.extensions)[number],
						AgentTool,
						Message[]
					>({ extensions: loaded.extensions });
					await registry.initialize();
					entry.commands = registry.getRegistrySnapshot().commands;
					entry.catalog = {
						workspacePath: entry.workspacePath,
						status: error ? "error" : "ready",
						error,
						commands: listPluginCommands(entry.commands),
					};
					if (!error) entry.retryCount = 0;
				} catch (error) {
					await entry.loaded?.shutdown?.().catch(() => {});
					entry.loaded = undefined;
					entry.catalog = {
						workspacePath: entry.workspacePath,
						status: "error",
						commands: [],
						error: error instanceof Error ? error.message : String(error),
					};
					this.options.logger?.error?.(
						"Plugin command discovery failed; retrying",
						{ error },
					);
				}
				if (entry.catalog.status === "error") {
					this.schedule(
						entry,
						Math.min(
							(this.options.retryDelayMs ?? 1000) * 2 ** entry.retryCount++,
							30_000,
						),
					);
				}
				if (!this.disposed) {
					this.watch(entry);
					for (const listener of this.listeners) {
						try {
							listener(structuredClone(entry.catalog));
						} catch (error) {
							this.options.logger?.error?.("Plugin command subscriber failed", {
								error,
							});
						}
					}
				}
			})
			.finally(() => {
				entry.pending = undefined;
				if (entry.dirty) this.schedule(entry, 0);
			});
		entry.tail = entry.pending.catch(() => {});
		return entry.pending;
	}
	async list(target: PluginCommandTarget): Promise<PluginCommandCatalog> {
		const entry = this.entry(target);
		await this.refresh(entry);
		return structuredClone(entry.catalog);
	}
	async run(input: PluginCommandTarget & { prompt: string }) {
		const entry = this.entry(input);
		await this.refresh(entry);
		if (this.disposed) throw new Error("Plugin command manager is disposed");
		const run = entry.tail.then(() =>
			executePluginCommand(entry.commands, input.prompt),
		);
		entry.tail = run.catch(() => {});
		return await run;
	}
	async dispose(): Promise<void> {
		this.disposed = true;
		this.listeners.clear();
		await Promise.all(
			[...this.entries.values()].map(async (entry) => {
				clearTimeout(entry.timer);
				for (const watcher of entry.watchers) watcher.close();
				await entry.tail;
				await entry.loaded?.shutdown?.();
			}),
		);
		this.entries.clear();
	}
}
