import { createHash } from "node:crypto";
import { resolve } from "node:path";
import {
	type AgentExtensionCommand,
	type AgentTool,
	type BasicLogger,
	createContributionRegistry,
	type ITelemetryService,
	type Message,
} from "@cline/shared";
import {
	resolveAgentPluginPaths,
	resolveAndLoadAgentPlugins,
} from "../extensions/plugin/plugin-config-loader";
import { fingerprintPluginSources } from "../extensions/plugin/plugin-module-import";
import { PluginRegistry } from "../extensions/plugin/plugin-registry";
import {
	executePluginCommand,
	listPluginCommands,
	type PluginCommandCatalog,
	type PluginCommandResult,
	type PluginCommandTarget,
} from "./plugin-command-api";

// A failed load may be transient (sandbox startup timeout, I/O hiccup), so it
// is retried on a later request instead of waiting for a source change.
const FAILED_LOAD_RETRY_MS = 30_000;
// The Hub is long-lived and shared across workspaces; release plugin workers
// for workspaces that stop asking for commands.
const IDLE_EVICTION_MS = 10 * 60_000;

type Entry = {
	workspacePath: string;
	key?: string;
	catalog: PluginCommandCatalog;
	commands: AgentExtensionCommand[];
	failedAt?: number;
	shutdown?: () => Promise<void>;
	/** Serializes loads, execution, and disposal so a handler cannot lose its sandbox. */
	tail: Promise<unknown>;
	idleTimer?: ReturnType<typeof setTimeout>;
};

/** Runtime-owned workspace catalogs. Session execution uses the session registry instead. */
export class PluginCommandManager {
	private readonly entries = new Map<string, Entry>();
	private disposed = false;
	constructor(
		private readonly options: {
			logger?: BasicLogger;
			telemetry?: ITelemetryService;
			load?: typeof resolveAndLoadAgentPlugins;
		} = {},
	) {}

	async list(target: PluginCommandTarget): Promise<PluginCommandCatalog> {
		return this.withEntry(target, (entry) => structuredClone(entry.catalog));
	}

	async run(
		input: PluginCommandTarget & { prompt: string },
	): Promise<PluginCommandResult | undefined> {
		return this.withEntry(input, (entry) =>
			executePluginCommand(entry.commands, input.prompt, {
				telemetry: this.options.telemetry,
			}),
		);
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		const entries = [...this.entries.values()];
		this.entries.clear();
		await Promise.all(entries.map((entry) => this.release(entry)));
	}

	private withEntry<T>(
		target: PluginCommandTarget,
		operation: (entry: Entry) => T | Promise<T>,
	): Promise<T> {
		if (this.disposed) throw new Error("Plugin command manager is disposed");
		const workspacePath = resolve(target.workspacePath);
		let entry = this.entries.get(workspacePath);
		if (!entry) {
			entry = {
				workspacePath,
				catalog: { workspacePath, status: "ready", commands: [] },
				commands: [],
				tail: Promise.resolve(),
			};
			this.entries.set(workspacePath, entry);
		}
		const current = entry;
		clearTimeout(current.idleTimer);
		current.idleTimer = setTimeout(() => {
			if (this.entries.get(workspacePath) !== current) return;
			this.entries.delete(workspacePath);
			void this.release(current);
		}, IDLE_EVICTION_MS);
		current.idleTimer.unref?.();
		const result = current.tail.then(async () => {
			await this.refresh(current);
			return operation(current);
		});
		current.tail = result.catch(() => {});
		return result;
	}

	private async release(entry: Entry): Promise<void> {
		clearTimeout(entry.idleTimer);
		await entry.tail;
		const shutdown = entry.shutdown;
		entry.shutdown = undefined;
		await shutdown?.().catch(() => {});
	}

	/** Fingerprint discoverable entries and their import graphs. The entry list
	 * already excludes plugins disabled in settings, so other settings do not
	 * participate. Runtime output beside a plugin is not source either. */
	private fingerprint(workspacePath: string): string {
		const hash = createHash("sha256");
		try {
			const paths = resolveAgentPluginPaths({
				cwd: workspacePath,
				workspacePath,
			});
			hash.update(JSON.stringify(paths));
			for (const path of paths) hash.update(fingerprintPluginSources(path));
		} catch (error) {
			hash.update(`discovery:${String(error)}`);
		}
		return hash.digest("hex");
	}

	private async refresh(entry: Entry): Promise<void> {
		const key = this.fingerprint(entry.workspacePath);
		if (
			key === entry.key &&
			(entry.failedAt === undefined ||
				Date.now() - entry.failedAt < FAILED_LOAD_RETRY_MS)
		)
			return;
		await entry.shutdown?.().catch(() => {});
		entry.key = key;
		entry.shutdown = undefined;
		entry.commands = [];
		entry.failedAt = undefined;
		let error: string | undefined;
		try {
			// A registry of its own: a catalog import failure must not block the
			// shared process registry's copies in live sessions, and a fresh one
			// per load lets the retry re-import a plugin the last load blocked.
			const loaded = await (this.options.load ?? resolveAndLoadAgentPlugins)({
				cwd: entry.workspacePath,
				workspacePath: entry.workspacePath,
				registry: new PluginRegistry({ logger: this.options.logger }),
			});
			entry.shutdown = loaded.shutdown;
			const registry = createContributionRegistry<
				(typeof loaded.extensions)[number],
				AgentTool,
				Message[]
			>({ extensions: loaded.extensions });
			await registry.initialize();
			entry.commands = registry.getRegistrySnapshot().commands;
			if (loaded.failures.length)
				error = loaded.failures.map((failure) => failure.message).join("; ");
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
			this.options.logger?.error?.("Plugin command discovery failed", {
				error: cause,
			});
		}
		if (error) entry.failedAt = Date.now();
		entry.catalog = {
			workspacePath: entry.workspacePath,
			status: error ? "error" : "ready",
			error,
			commands: listPluginCommands(entry.commands),
		};
	}
}
