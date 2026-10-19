import { createHash } from "node:crypto";
import { existsSync, type FSWatcher, statSync, watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import {
	type AgentExtensionCommand,
	type AgentTool,
	type BasicLogger,
	createContributionRegistry,
	type ITelemetryService,
	type Message,
} from "@cline/shared";
import { resolveGlobalSettingsPath } from "@cline/shared/storage";
import {
	loadResolvedAgentPlugins,
	resolveAgentPluginPaths,
	resolvePluginConfigSearchPaths,
} from "../extensions/plugin/plugin-config-loader";
import { fingerprintPluginSources } from "../extensions/plugin/plugin-module-import";
import { PluginRegistry } from "../extensions/plugin/plugin-registry";
import {
	executePluginCommand,
	listPluginCommands,
	type PluginCommandCatalog,
	type PluginCommandsApi,
	type PluginCommandTarget,
} from "./plugin-command-api";

const MAX_CATALOG_REFRESH_PASSES = 2;

type LoadedPlugins = Awaited<ReturnType<typeof loadResolvedAgentPlugins>>;
type LoadedPlugin = {
	path: string;
	loaded: LoadedPlugins;
	contributions: Array<{ name: string; commands: AgentExtensionCommand[] }>;
};
type Entry = {
	workspacePath: string;
	registry: PluginRegistry;
	catalog: PluginCommandCatalog;
	commands: AgentExtensionCommand[];
	loaded: LoadedPlugin[];
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
			telemetry?: ITelemetryService;
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
				registry: new PluginRegistry({ logger: this.options.logger }),
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
	/** Fingerprint discoverable entries, their import graphs, and plugin settings.
	 * Runtime output beside a plugin is not source and must not reset its state. */
	private async fingerprint(entry: Entry): Promise<string> {
		const hash = createHash("sha256");
		try {
			const paths = resolveAgentPluginPaths({
				cwd: entry.workspacePath,
				workspacePath: entry.workspacePath,
			});
			hash.update(JSON.stringify(paths));
			for (const path of paths) hash.update(fingerprintPluginSources(path));
		} catch (error) {
			hash.update(`discovery:${String(error)}`);
		}
		try {
			hash.update(await readFile(resolveGlobalSettingsPath()));
		} catch (error) {
			hash.update(
				`settings:${(error as NodeJS.ErrnoException).code ?? "unknown"}`,
			);
		}
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
			const targetDirectory = root === settings ? dirname(root) : root;
			let directory = targetDirectory;
			while (!existsSync(directory) && dirname(directory) !== directory)
				directory = dirname(directory);
			try {
				const recursive =
					directory === root && statSync(directory).isDirectory();
				const watcher = (this.options.watch ?? watch)(
					directory,
					{ recursive, persistent: false },
					(event, file) => {
						const changed = file ? resolve(directory, String(file)) : directory;
						if (String(file).split(/[\\/]/).includes("node_modules")) return;
						if (
							changed !== root &&
							!changed.startsWith(`${root}${sep}`) &&
							!root.startsWith(`${changed}${sep}`)
						)
							return;
						// Directory creation/removal changes where we must listen even when
						// no discoverable plugin exists yet. Install the closer watch before
						// checking sources so later child events cannot fall through the gap.
						if (event === "rename" || directory !== targetDirectory)
							this.watch(entry);
						void this.fingerprint(entry).then((fingerprint) => {
							if (this.disposed || fingerprint === entry.fingerprint) return;
							entry.dirty = true;
							this.schedule(entry, 100);
						});
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
	private async loadPlugin(
		entry: Entry,
		pluginPaths: string[],
		retryOnly: boolean,
	): Promise<{ failedPaths: string[]; errors: string[] }> {
		const failedPaths: string[] = [];
		const errors: string[] = [];
		let loaded: LoadedPlugins | undefined;
		try {
			if (retryOnly && !this.options.load) {
				for (const path of pluginPaths) {
					if (
						entry.registry.get(path).some((status) => status.state === "failed")
					)
						await entry.registry.reload(path);
				}
			}
			loaded = await (this.options.load ?? loadResolvedAgentPlugins)({
				cwd: entry.workspacePath,
				workspacePath: entry.workspacePath,
				pluginPaths,
				registry: entry.registry,
			});
			const contributions: LoadedPlugin["contributions"] = [];
			for (const extension of loaded.extensions) {
				const registry = createContributionRegistry<
					typeof extension,
					AgentTool,
					Message[]
				>({ extensions: [extension] });
				await registry.initialize();
				contributions.push({
					name: extension.name,
					commands: registry.getRegistrySnapshot().commands,
				});
			}
			failedPaths.push(...loaded.failures.map((failure) => failure.pluginPath));
			errors.push(...loaded.failures.map((failure) => failure.message));
			if (contributions.length)
				entry.loaded.push({
					path: pluginPaths[0] ?? "",
					loaded,
					contributions,
				});
			else await loaded.shutdown?.();
		} catch (cause) {
			await loaded?.shutdown?.().catch(() => {});
			failedPaths.push(...pluginPaths);
			errors.push(cause instanceof Error ? cause.message : String(cause));
			this.options.logger?.error?.(
				"Plugin command discovery failed; retrying",
				{ error: cause },
			);
		}
		return { failedPaths, errors };
	}
	private async selectCommands(entry: Entry): Promise<void> {
		const selected = new Map<
			string,
			{ owner: LoadedPlugin; commands: AgentExtensionCommand[] }
		>();
		entry.loaded.sort(
			(a, b) =>
				entry.pluginPaths.indexOf(a.path) - entry.pluginPaths.indexOf(b.path),
		);
		for (const owner of entry.loaded) {
			for (const contribution of owner.contributions) {
				selected.delete(contribution.name);
				selected.set(contribution.name, {
					owner,
					commands: contribution.commands,
				});
			}
		}
		const owners = new Set([...selected.values()].map(({ owner }) => owner));
		await Promise.all(
			entry.loaded
				.filter((owner) => !owners.has(owner))
				.map(({ loaded }) => loaded.shutdown?.()),
		);
		entry.loaded = entry.loaded.filter((owner) => owners.has(owner));
		entry.commands = [...selected.values()].flatMap(({ commands }) => commands);
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
						entry.loaded.map(({ loaded }) =>
							loaded.shutdown?.().catch(() => {}),
						),
					);
					entry.loaded = [];
					entry.commands = [];
					entry.failedPaths = undefined;
				}
				const errors: string[] = [];
				if (!retryOnly) entry.fingerprint = await this.fingerprint(entry);
				try {
					if (!entry.failedPaths) {
						entry.pluginPaths = resolveAgentPluginPaths({
							cwd: entry.workspacePath,
							workspacePath: entry.workspacePath,
						});
						entry.failedPaths = entry.pluginPaths;
						// Cover edits during initialization, as well as later watcher outages.
						entry.fingerprint = await this.fingerprint(entry);
						this.watch(entry);
					}
					const paths = entry.failedPaths;
					entry.failedPaths = [];
					// Each path owns its worker lifetime so a recovered override can
					// release its predecessor without restarting unrelated plugins.
					const results = await Promise.all(
						(paths.length ? paths.map((path) => [path]) : [[]]).map((paths) =>
							this.loadPlugin(entry, paths, retryOnly),
						),
					);
					entry.failedPaths = [
						...new Set(results.flatMap((result) => result.failedPaths)),
					];
					errors.push(...results.flatMap((result) => result.errors));
					await this.selectCommands(entry);
					if (!errors.length) entry.retryCount = 0;
				} catch (cause) {
					errors.push(cause instanceof Error ? cause.message : String(cause));
				}
				const error = errors.join("; ") || undefined;
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
					this.schedule(entry, entry.dirty ? 100 : 0, !entry.dirty);
			});
		entry.tail = entry.pending.catch(() => {});
		return entry.pending;
	}
	private async ensureFresh(entry: Entry): Promise<void> {
		for (let pass = 0; pass < MAX_CATALOG_REFRESH_PASSES; pass++) {
			await this.refresh(entry);
			if (this.disposed) return;
			// Watchers keep menus current, but imports can reach outside their
			// roots. Check the loaded graph before serving either API request.
			const fingerprint = await this.fingerprint(entry);
			if (fingerprint === entry.fingerprint) return;
			entry.dirty = true;
		}
		throw new Error(
			"Plugin sources changed repeatedly during command discovery. Retry after edits settle.",
		);
	}
	async list(target: PluginCommandTarget): Promise<PluginCommandCatalog> {
		const entry = this.entry(target);
		await this.ensureFresh(entry);
		return structuredClone(entry.catalog);
	}
	async run(input: PluginCommandTarget & { prompt: string }) {
		const entry = this.entry(input);
		await this.ensureFresh(entry);
		if (this.disposed) throw new Error("Plugin command manager is disposed");
		const run = entry.tail.then(() =>
			executePluginCommand(entry.commands, input.prompt, {
				telemetry: this.options.telemetry,
			}),
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
				await Promise.all(
					entry.loaded.map(({ loaded }) => loaded.shutdown?.()),
				);
			}),
		);
		this.entries.clear();
	}
}
