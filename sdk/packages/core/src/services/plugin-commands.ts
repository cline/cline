import { createHash } from "node:crypto";
import { existsSync, type FSWatcher, statSync, watch } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
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
	loadResolvedAgentPlugins,
	resolveAgentPluginPaths,
	resolvePluginConfigSearchPaths,
} from "../extensions/plugin/plugin-config-loader";
import {
	executePluginCommand,
	listPluginCommands,
	type PluginCommandCatalog,
	type PluginCommandsApi,
	type PluginCommandTarget,
} from "./plugin-command-api";

type LoadedPlugins = Awaited<ReturnType<typeof loadResolvedAgentPlugins>>;
type Entry = {
	workspacePath: string;
	catalog: PluginCommandCatalog;
	commands: AgentExtensionCommand[];
	loaded: LoadedPlugins[];
	pluginPaths: string[];
	failedPaths?: string[];
	retryDue: boolean;
	pending?: Promise<void>;
	dirty: boolean;
	retryCount: number;
	timer?: ReturnType<typeof setTimeout>;
	watchers: FSWatcher[];
	watchRetry?: ReturnType<typeof setTimeout>;
	fingerprint?: string;
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
			load?: typeof loadResolvedAgentPlugins;
			retryDelayMs?: number;
			watch?: typeof watch;
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
				loaded: [],
				pluginPaths: [],
				retryDue: false,
				dirty: true,
				retryCount: 0,
				watchers: [],
				tail: Promise.resolve(),
			};
			this.entries.set(workspacePath, entry);
		}
		return entry;
	}
	private schedule(entry: Entry, delay: number, retryOnly = false): void {
		if (this.disposed) return;
		clearTimeout(entry.timer);
		entry.timer = setTimeout(() => {
			if (retryOnly) entry.retryDue = true;
			else entry.dirty = true;
			void this.refresh(entry);
		}, delay);
		entry.timer.unref?.();
	}
	private watchRoots(entry: Entry): Set<string> {
		return new Set([
			...resolvePluginConfigSearchPaths(entry.workspacePath),
			...entry.pluginPaths.map(dirname),
			resolveGlobalSettingsPath(),
		]);
	}
	/**
	 * Compare contents across watcher outages without replacing unchanged plugin instances.
	 * Unreadable entries contribute their error code instead of failing the scan.
	 */
	private async fingerprint(entry: Entry): Promise<string> {
		const hash = createHash("sha256");
		const visited = new Set<string>();
		const visit = async (path: string): Promise<void> => {
			hash.update(JSON.stringify(path));
			try {
				const real = await realpath(path);
				if (visited.has(real)) return;
				visited.add(real);
				const info = await stat(path);
				if (info.isDirectory()) {
					for (const name of (await readdir(path)).sort()) {
						if (name !== "node_modules") await visit(resolve(path, name));
					}
				} else if (info.isFile()) hash.update(await readFile(path));
			} catch (error) {
				hash.update(
					`error:${(error as NodeJS.ErrnoException).code ?? "unknown"}`,
				);
			}
		};
		for (const root of [...this.watchRoots(entry)].sort()) await visit(root);
		return hash.digest("hex");
	}
	private reconnect(entry: Entry): void {
		if (this.disposed) return;
		clearTimeout(entry.watchRetry);
		entry.watchRetry = setTimeout(() => {
			if (this.disposed) return;
			// Install watchers first, then reconcile changes missed during the outage.
			this.watch(entry);
			void this.fingerprint(entry).then((fingerprint) => {
				if (this.disposed || fingerprint === entry.fingerprint) return;
				entry.dirty = true;
				void this.refresh(entry);
			});
		}, 1000);
		entry.watchRetry.unref?.();
	}
	private watch(entry: Entry): void {
		clearTimeout(entry.watchRetry);
		if (this.disposed) return;
		for (const watcher of entry.watchers) watcher.close();
		entry.watchers = [];
		const settings = resolveGlobalSettingsPath();
		const roots = this.watchRoots(entry);
		for (const root of roots) {
			let directory = root === settings ? dirname(root) : root;
			while (!existsSync(directory) && dirname(directory) !== directory)
				directory = dirname(directory);
			try {
				const recursive =
					directory === root && statSync(directory).isDirectory();
				const watcher = (this.options.watch ?? watch)(
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
				watcher.on("error", (error) => {
					this.options.logger?.debug?.(
						"Plugin command watcher failed; reconnecting",
						{ directory, error },
					);
					this.reconnect(entry);
				});
				entry.watchers.push(watcher);
			} catch (error) {
				this.options.logger?.debug?.("Plugin command watcher unavailable", {
					directory,
					error,
				});
				this.reconnect(entry);
			}
		}
	}
	private refresh(entry: Entry): Promise<void> {
		if (entry.pending) return entry.pending;
		if ((!entry.dirty && !entry.retryDue) || this.disposed)
			return Promise.resolve();
		const retryOnly = !entry.dirty;
		entry.dirty = false;
		entry.retryDue = false;
		clearTimeout(entry.timer);
		entry.pending = entry.tail
			.then(async () => {
				if (this.disposed) return;
				if (!retryOnly) {
					await Promise.all(
						entry.loaded.map((loaded) => loaded.shutdown?.().catch(() => {})),
					);
					entry.loaded = [];
					entry.commands = [];
					entry.failedPaths = undefined;
				}
				let loaded: LoadedPlugins | undefined;
				let error: string | undefined;
				try {
					if (!entry.failedPaths) {
						entry.pluginPaths = resolveAgentPluginPaths({
							cwd: entry.workspacePath,
							workspacePath: entry.workspacePath,
						});
						entry.failedPaths = entry.pluginPaths;
						entry.fingerprint = await this.fingerprint(entry);
					}
					loaded = await (this.options.load ?? loadResolvedAgentPlugins)({
						cwd: entry.workspacePath,
						workspacePath: entry.workspacePath,
						pluginPaths: entry.failedPaths,
					});
					const registry = createContributionRegistry<
						(typeof loaded.extensions)[number],
						AgentTool,
						Message[]
					>({ extensions: loaded.extensions });
					await registry.initialize();
					entry.commands.push(...registry.getRegistrySnapshot().commands);
					entry.failedPaths = [
						...new Set(loaded.failures.map((failure) => failure.pluginPath)),
					];
					error =
						loaded.failures.map((failure) => failure.message).join("; ") ||
						undefined;
					if (loaded.extensions.length) entry.loaded.push(loaded);
					else await loaded.shutdown?.();
					if (!error) entry.retryCount = 0;
				} catch (cause) {
					await loaded?.shutdown?.().catch(() => {});
					error = cause instanceof Error ? cause.message : String(cause);
					this.options.logger?.error?.(
						"Plugin command discovery failed; retrying",
						{ error: cause },
					);
				}
				entry.catalog = {
					workspacePath: entry.workspacePath,
					status: error ? "error" : "ready",
					error,
					commands: listPluginCommands(entry.commands),
				};
				if (error)
					this.schedule(
						entry,
						Math.min(
							(this.options.retryDelayMs ?? 1000) * 2 ** entry.retryCount++,
							30_000,
						),
						true,
					);
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
				if (entry.dirty || entry.retryDue)
					this.schedule(entry, 0, !entry.dirty);
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
				clearTimeout(entry.watchRetry);
				for (const watcher of entry.watchers) watcher.close();
				await entry.tail;
				await Promise.all(entry.loaded.map((loaded) => loaded.shutdown?.()));
			}),
		);
		this.entries.clear();
	}
}
