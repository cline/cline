import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import type {
	AgentExtension,
	AgentExtensionApi,
	AgentExtensionCommand,
	AgentExtensionMessageBuilder,
	AgentExtensionRule,
	AgentTool,
	AgentToolContext,
	BasicLogger,
	Message,
	PluginErrorPhase,
	PluginErrorRecord,
	PluginPolicies,
	PluginRuntimeState,
	PluginSetupContext,
	PluginStatusRecord,
	SessionPluginIssue,
} from "@cline/shared";
import { getPluginDisplayName } from "@cline/shared/storage";
import { markPluginCommand } from "./plugin-command-origin";
import type {
	PluginInitializationFailure,
	PluginInitializationWarning,
} from "./plugin-load-report";
import { fingerprintPluginSources } from "./plugin-module-import";
import { loadSandboxedPlugins } from "./plugin-sandbox";

export { isPluginCommand } from "./plugin-command-origin";

import type { PluginTargeting } from "./plugin-targeting";

export const DEFAULT_PLUGIN_IMPORT_TIMEOUT_MS = 4_000;
export const DEFAULT_PLUGIN_SETUP_TIMEOUT_MS = 4_000;
export const DEFAULT_PLUGIN_HOOK_TIMEOUT_MS = 3_000;
/** Tools, commands, rule content, and message builders. */
export const DEFAULT_PLUGIN_TOOL_TIMEOUT_MS = 60_000;
/** Consecutive call failures after which a plugin is turned off. */
export const DEFAULT_PLUGIN_FAILURE_THRESHOLD = 5;

const PLUGIN_IMPORT_TIMEOUT_ENV = "CLINE_PLUGIN_IMPORT_TIMEOUT_MS";

export type PluginHookErrorMode = "ignore" | "throw";

export class PluginCallTimeoutError extends Error {
	constructor(
		readonly label: string,
		readonly timeoutMs: number,
	) {
		super(`${label} timed out after ${timeoutMs}ms`);
		this.name = "PluginCallTimeoutError";
	}
}

type ExtensionHooks = NonNullable<AgentExtension["hooks"]>;
type HookFn = (...args: unknown[]) => unknown;
type SetupApi = AgentExtensionApi<AgentTool, Message[]>;

interface PluginEntry {
	pluginPath: string;
	/** Directory (package plugins) or the file itself (drop-in plugins). */
	pluginRoot: string;
	name: string;
	state: PluginRuntimeState;
	/**
	 * Set when the plugin is turned off for every session: import or discovery
	 * failed, a stray error was attributed to it, or calls kept failing. A
	 * `setup()` failure alone is per session and does not set this.
	 */
	blocked: boolean;
	consecutiveFailures: number;
	/**
	 * Bumped on every (re)import of the entry. Copies stamped with an older
	 * value are stale: their failures are reported to their own session but
	 * do not count against the current module.
	 */
	importId: number;
	/** The imported module, read for metadata (name, manifest). */
	extension?: AgentExtension;
	fingerprint?: string;
	lastError?: PluginErrorRecord;
	errorCount: number;
	timeoutCount: number;
	/** Sessions holding a copy, with their `onIssue` callback. */
	sessions: Map<string, ((issue: SessionPluginIssue) => void) | undefined>;
	/** The export the plugin was last loaded from, reused by `reload`. */
	exportName?: string;
	/**
	 * The plugin's own (exported) name has been seen for its current code.
	 * Until then `name` is derived from the path, so the host cannot apply a
	 * policy that names the plugin and leaves it to the worker.
	 */
	nameResolved?: boolean;
	updatedAt: number;
}

/** One session's copy of a plugin module. */
interface PluginInstance {
	extension: AgentExtension;
	/** The entry's `importId` when this copy was imported. */
	importId: number;
	setupFailed: boolean;
	closed: boolean;
	/** Cleanup registered through `ctx.onDispose`. */
	disposers: Array<() => void | Promise<void>>;
	/** Stops the worker the copy runs in. */
	shutdown?: () => Promise<void>;
	/** The session's event sink, given to tools that do not bring their own. */
	emitEvent?: (name: string, payload?: unknown) => void;
}

interface PluginTimeouts {
	import: number;
	setup: number;
	hook: number;
	call: number;
}

export interface PluginRegistryOptions {
	logger?: BasicLogger;
	importTimeoutMs?: number;
	setupTimeoutMs?: number;
	hookTimeoutMs?: number;
	toolTimeoutMs?: number;
	failureThreshold?: number;
}

export interface PluginSessionLoadInput extends PluginTargeting {
	sessionId?: string;
	/** Resolved, enabled plugin module paths, in load order. */
	pluginPaths: ReadonlyArray<string>;
	/** Plugin paths turned off in settings; reported as `disabled`. */
	disabledPluginPaths?: ReadonlyArray<string>;
	/** Configured paths that could not be resolved to a module. */
	discoveryFailures?: ReadonlyArray<{ pluginPath: string; error: unknown }>;
	policy?: PluginPolicies;
	exportName?: string;
	cwd?: string;
	hookErrorMode?: PluginHookErrorMode;
	setupContext?: PluginSetupContext;
	emitEvent?: (event: { name: string; payload?: unknown }) => void;
	/**
	 * Called when a call made for this session moves a plugin to `degraded`
	 * or `failed`. Setup runs lazily on the first turn, after the session
	 * start payload went out, so this is how those failures reach the user.
	 */
	onIssue?: (issue: SessionPluginIssue) => void;
	/** Per-session overrides of the registry's default timeouts. */
	importTimeoutMs?: number;
	hookTimeoutMs?: number;
	/** Tools (without their own `timeoutMs`), commands, rules, builders. */
	callTimeoutMs?: number;
}

export interface PluginSessionLoadResult {
	extensions: AgentExtension[];
	pluginPaths: string[];
	failures: PluginInitializationFailure[];
	warnings: PluginInitializationWarning[];
	issues: SessionPluginIssue[];
	/**
	 * Ends the session's use of its plugin copies: runs `ctx.onDispose`
	 * cleanup and stops further calls.
	 */
	release: () => Promise<void>;
}

export type PluginStatusListener = (status: PluginStatusRecord) => void;

function readTimeoutEnv(name: string): number | undefined {
	const raw = process.env[name]?.trim();
	if (!raw) return undefined;
	const parsed = Number(raw);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function toErrorParts(error: unknown): { message: string; stack?: string } {
	if (error instanceof Error) {
		return { message: error.message, stack: error.stack };
	}
	return { message: String(error) };
}

/**
 * Package plugins own their whole package directory; a single-file plugin
 * in a shared `plugins/` folder owns only its file. The root decides the
 * plugin's display name before its module is imported.
 */
function resolvePluginRoot(pluginPath: string): string {
	let current = dirname(pluginPath);
	for (let depth = 0; depth < 4; depth++) {
		const manifestPath = join(current, "package.json");
		if (existsSync(manifestPath)) {
			try {
				const pkg = JSON.parse(readFileSync(manifestPath, "utf8"));
				if (pkg && typeof pkg === "object" && "cline" in pkg) {
					return current;
				}
			} catch {
				// Malformed manifest: fall back to the file itself.
			}
			return pluginPath;
		}
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return pluginPath;
}

/** Name used before the module is imported (or when it never imports). */
function derivePluginName(pluginPath: string, pluginRoot: string): string {
	return pluginRoot === pluginPath
		? basename(pluginPath, extname(pluginPath))
		: getPluginDisplayName(pluginPath, pluginRoot);
}

/** The name a plugin is known by before its module is imported. */
export function derivePluginNameFromPath(pluginPath: string): string {
	const absolute = resolve(pluginPath);
	return derivePluginName(absolute, resolvePluginRoot(absolute));
}

function runWithTimeout<T>(
	fn: () => T | Promise<T>,
	timeoutMs: number,
	label: string,
): Promise<T> {
	return new Promise<T>((resolvePromise, rejectPromise) => {
		let settled = false;
		const timer = setTimeout(() => {
			settled = true;
			rejectPromise(new PluginCallTimeoutError(label, timeoutMs));
		}, timeoutMs);
		timer.unref?.();
		Promise.resolve()
			.then(fn)
			.then(
				(value) => {
					if (settled) return;
					settled = true;
					clearTimeout(timer);
					resolvePromise(value);
				},
				(error) => {
					if (settled) return;
					settled = true;
					clearTimeout(timer);
					rejectPromise(error);
				},
			);
	});
}

/** Applies a `toolPolicies`-shaped plugin policy to a plugin's names. */
function isPluginEnabledByPolicy(
	policy: PluginPolicies | undefined,
	names: ReadonlyArray<string>,
): boolean {
	if (!policy) return true;
	for (const name of names) {
		const enabled = policy[name]?.enabled;
		if (typeof enabled === "boolean") return enabled;
	}
	return policy["*"]?.enabled ?? true;
}

function newInstance(importId: number): PluginInstance {
	return {
		// Assigned as soon as the worker reports its import; never read before.
		extension: undefined as unknown as AgentExtension,
		importId,
		setupFailed: false,
		closed: false,
		disposers: [],
	};
}

/**
 * Tracks plugins for the whole process and hands each session a guarded copy
 * of the plugins it enabled. Each copy runs in its own worker thread, so
 * module state is per session and plugin code never runs on the host's main
 * thread. Every import, setup, hook, tool, command, rule, and message-builder
 * call is wrapped with a timeout and error capture, and the result is
 * recorded per plugin so failures are visible instead of silently dropping
 * the plugin's tools.
 */
export class PluginRegistry {
	private readonly entries = new Map<string, PluginEntry>();
	private readonly listeners = new Set<PluginStatusListener>();
	private logger: BasicLogger | undefined;
	private readonly defaults: PluginTimeouts;
	private readonly failureThreshold: number;

	constructor(options: PluginRegistryOptions = {}) {
		this.logger = options.logger;
		this.defaults = {
			import:
				options.importTimeoutMs ??
				readTimeoutEnv(PLUGIN_IMPORT_TIMEOUT_ENV) ??
				DEFAULT_PLUGIN_IMPORT_TIMEOUT_MS,
			setup: options.setupTimeoutMs ?? DEFAULT_PLUGIN_SETUP_TIMEOUT_MS,
			hook: options.hookTimeoutMs ?? DEFAULT_PLUGIN_HOOK_TIMEOUT_MS,
			call: options.toolTimeoutMs ?? DEFAULT_PLUGIN_TOOL_TIMEOUT_MS,
		};
		this.failureThreshold =
			options.failureThreshold ?? DEFAULT_PLUGIN_FAILURE_THRESHOLD;
	}

	setLogger(logger: BasicLogger | undefined): void {
		this.logger = logger;
	}

	subscribe(listener: PluginStatusListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	list(): PluginStatusRecord[] {
		return [...this.entries.values()]
			.map((entry) => this.toStatus(entry))
			.sort((left, right) => left.name.localeCompare(right.name));
	}

	get(nameOrPath: string): PluginStatusRecord[] {
		return this.match(nameOrPath).map((entry) => this.toStatus(entry));
	}

	/**
	 * Re-validates the matching plugins' current code in throwaway workers and
	 * resets their status. Sessions started afterwards use the new code;
	 * running sessions keep the copy they set up, which stays callable unless
	 * the re-import fails (the plugin is then turned off for every session,
	 * failing closed).
	 */
	async reload(nameOrPath: string): Promise<PluginStatusRecord[]> {
		const matches = this.match(nameOrPath);
		for (const entry of matches) {
			entry.lastError = undefined;
			entry.errorCount = 0;
			entry.timeoutCount = 0;
			this.log("info", "plugin.reload", entry, {});
			await this.reloadEntry(entry);
		}
		return matches.map((entry) => this.toStatus(entry));
	}

	/**
	 * Loads each plugin in a throwaway worker without attaching it to a
	 * session, so the Hub can discover plugins at startup and report status
	 * (including import errors) before any session exists.
	 */
	async preload(
		input: Pick<
			PluginSessionLoadInput,
			| "pluginPaths"
			| "disabledPluginPaths"
			| "discoveryFailures"
			| "exportName"
			| "importTimeoutMs"
		>,
	): Promise<PluginStatusRecord[]> {
		const loaded = await this.loadForSession(input);
		await loaded.release();
		return this.list();
	}

	/**
	 * Each plugin loads in its own worker for this session, and the copy
	 * handed to the session is a proxy whose calls go to that worker. The host
	 * never imports plugin code. Every setup, hook, tool, command, rule, and
	 * message-builder call is wrapped with a timeout and error capture, and
	 * the result is recorded per plugin.
	 */
	async loadForSession(
		input: PluginSessionLoadInput,
	): Promise<PluginSessionLoadResult> {
		const failures: PluginInitializationFailure[] = [];
		const warnings: PluginInitializationWarning[] = [];
		const issues: SessionPluginIssue[] = [];
		const sessionId = input.sessionId;
		const timeouts = this.resolveTimeouts(input);

		for (const entry of this.recordDiscovery(input, issues)) {
			failures.push(this.toInitializationFailure(entry));
		}

		const candidates: PluginEntry[] = [];
		for (const rawPath of input.pluginPaths) {
			const entry = this.ensureEntry(resolve(rawPath));
			entry.exportName = input.exportName;
			this.refreshEntry(entry);
			// Skip the worker only when the plugin's own name is known; else the
			// worker applies the policy after import, before setup.
			if (entry.nameResolved && !this.isEnabledForSession(entry, input)) {
				issues.push(this.policyIssue(entry));
				continue;
			}
			if (entry.blocked) {
				failures.push(this.toInitializationFailure(entry));
				issues.push(this.toIssue(entry, "error"));
				continue;
			}
			candidates.push(entry);
		}

		const started = await Promise.all(
			candidates.map((entry) =>
				this.startWorkerCopy(entry, input, timeouts, sessionId),
			),
		);

		const loadedByName = new Map<
			string,
			{ entry: PluginEntry; instance: PluginInstance; order: number }
		>();
		let order = 0;
		for (const result of started) {
			const { entry } = result;
			if ("error" in result) {
				if (result.importId !== entry.importId) {
					// The plugin changed while this copy was loading; the failure
					// describes the old code, so only this session hears of it.
					issues.push(
						this.staleIssue(entry, result.phase, result.error, sessionId),
					);
					continue;
				}
				if (result.phase === "setup") {
					// A setup failure costs only this session.
					this.recordFailure(entry, "setup", result.error, {
						sessionId,
						state: "failed",
					});
				} else {
					this.recordFailure(entry, "import", result.error, {
						fatal: true,
						sessionId,
					});
				}
				failures.push(this.toInitializationFailure(entry));
				issues.push(this.toIssue(entry, "error"));
				continue;
			}
			if ("policyDisabled" in result) {
				issues.push(this.policyIssue(entry));
				continue;
			}
			if (!result.instance) continue; // Manifest targeting excluded it.
			const { instance } = result;
			// The module's own name is known now; the policy may name it.
			if (!this.isEnabledForSession(entry, input)) {
				issues.push(this.policyIssue(entry));
				await instance.shutdown?.().catch(() => {});
				continue;
			}
			const existing = loadedByName.get(entry.name);
			if (existing) {
				warnings.push({
					type: "duplicate_plugin_override",
					pluginName: entry.name,
					pluginPath: entry.pluginPath,
					overriddenPluginPath: existing.entry.pluginPath,
					message: `Plugin "${entry.name}" from ${entry.pluginPath} overrides ${existing.entry.pluginPath}`,
				});
				await existing.instance.shutdown?.().catch(() => {});
			}
			loadedByName.set(entry.name, { entry, instance, order: order++ });
		}

		const selected = [...loadedByName.values()].sort(
			(left, right) => left.order - right.order,
		);
		if (sessionId) {
			for (const { entry } of selected) {
				entry.sessions.set(sessionId, input.onIssue);
			}
		}
		const extensions = selected.map(({ entry, instance }) =>
			this.wrapForSession(entry, instance, input, timeouts),
		);
		let released: Promise<void> | undefined;
		return {
			extensions,
			pluginPaths: selected.map(({ entry }) => entry.pluginPath),
			failures,
			warnings,
			issues,
			release: () => {
				released ??= Promise.all(
					selected.map(({ entry, instance }) =>
						this.releaseInstance(entry, instance, sessionId, timeouts),
					),
				).then(() => undefined);
				return released;
			},
		};
	}

	/**
	 * Every worker imports the module fresh, so new code needs no host
	 * re-import. A source change (or re-enabling) still starts a new import
	 * id: the plugin gets a clean slate, and copies of the old code go stale.
	 */
	private refreshEntry(entry: PluginEntry): void {
		const fingerprint = fingerprintPluginSources(entry.pluginPath);
		if (entry.fingerprint === fingerprint && entry.state !== "disabled") {
			return;
		}
		entry.fingerprint = fingerprint;
		entry.importId += 1;
		entry.blocked = false;
		entry.consecutiveFailures = 0;
		entry.extension = undefined;
		// New code may export a different name.
		entry.nameResolved = false;
		this.setState(entry, "loading", true);
	}

	private async startWorkerCopy(
		entry: PluginEntry,
		input: PluginSessionLoadInput,
		timeouts: PluginTimeouts,
		sessionId: string | undefined,
	): Promise<
		| { entry: PluginEntry; instance?: PluginInstance }
		| { entry: PluginEntry; policyDisabled: true }
		| {
				entry: PluginEntry;
				error: unknown;
				phase: "import" | "setup";
				importId: number;
		  }
	> {
		const importId = entry.importId;
		const instance = newInstance(importId);
		let ready = false;
		// Set once the import finished and setup() began, so a failure after
		// that (setup threw, timed out, or crashed the worker) costs only this
		// session's copy instead of turning the plugin off.
		let setupStarted = false;
		const setup = input.setupContext;
		const startedAt = Date.now();
		let loaded: Awaited<ReturnType<typeof loadSandboxedPlugins>>;
		try {
			loaded = await loadSandboxedPlugins({
				transport: "worker",
				pluginPaths: [entry.pluginPath],
				exportName: input.exportName,
				importTimeoutMs: timeouts.import,
				setupTimeoutMs: timeouts.setup,
				hookTimeoutMs: timeouts.hook,
				contributionTimeoutMs: timeouts.call,
				onEvent: input.emitEvent,
				onSetupStarted: () => {
					setupStarted = true;
				},
				policy: input.policy,
				policyNames: {
					[entry.pluginPath]: [
						derivePluginName(entry.pluginPath, entry.pluginRoot),
					],
				},
				// A worker that dies on its own (stray rejection, process.exit)
				// is this plugin's fault: the worker runs nothing else.
				onUnexpectedExit: (error) => {
					if (!ready || instance.closed) return;
					this.recordFailure(entry, "uncaught", error, {
						fatal: true,
						instance,
						sessionId,
					});
				},
				providerId: input.providerId,
				modelId: input.modelId,
				cwd: input.cwd,
				workspaceInfo: setup?.workspaceInfo,
				session: setup?.session,
				client: setup?.client,
				user: setup?.user,
				logger: setup?.logger,
				telemetryAvailable: Boolean(setup?.telemetry),
			});
		} catch (error) {
			// The worker failed before reporting back: it timed out, crashed, or
			// exited during import or setup.
			return {
				entry,
				error,
				phase: setupStarted ? "setup" : "import",
				importId,
			};
		}
		const disabled = loaded.disabledByPolicy[0];
		if (disabled) {
			await loaded.shutdown().catch(() => {});
			if (importId === entry.importId) {
				entry.name = disabled.name;
				entry.nameResolved = true;
			}
			return { entry, policyDisabled: true };
		}
		const failure = loaded.failures[0];
		const extension = loaded.extensions?.[0];
		if (failure || !extension) {
			await loaded.shutdown().catch(() => {});
			if (!failure) return { entry };
			const error = new Error(failure.message);
			if (failure.stack) error.stack = failure.stack;
			return {
				entry,
				error,
				phase: failure.phase === "setup" ? "setup" : "import",
				importId,
			};
		}
		ready = true;
		instance.extension = extension;
		instance.shutdown = loaded.shutdown;
		if (importId === entry.importId) {
			entry.name = extension.name;
			entry.nameResolved = true;
			entry.extension = extension;
			if (
				!entry.blocked &&
				(entry.state === "loading" || entry.state === "failed")
			) {
				this.setState(entry, "ready");
			}
			this.log("info", "plugin.import.ready", entry, {
				elapsedMs: Date.now() - startedAt,
			});
		}
		return { entry, instance };
	}

	/** Re-validates a plugin's current code in a throwaway worker. */
	private async reloadEntry(entry: PluginEntry): Promise<void> {
		entry.fingerprint = undefined;
		this.refreshEntry(entry);
		const input: PluginSessionLoadInput = {
			pluginPaths: [entry.pluginPath],
			exportName: entry.exportName,
		};
		const result = await this.startWorkerCopy(
			entry,
			input,
			this.resolveTimeouts(input),
			undefined,
		);
		if ("error" in result) {
			if (result.importId !== entry.importId) return;
			this.recordFailure(entry, result.phase, result.error, {
				fatal: result.phase === "import",
				...(result.phase === "setup" ? { state: "failed" as const } : {}),
			});
			return;
		}
		if ("instance" in result) {
			await result.instance?.shutdown?.().catch(() => {});
		}
	}

	private staleIssue(
		entry: PluginEntry,
		phase: PluginErrorPhase,
		error: unknown,
		sessionId: string | undefined,
	): SessionPluginIssue {
		const { message, stack } = toErrorParts(error);
		return {
			name: entry.name,
			pluginPath: entry.pluginPath,
			state: "failed",
			reason: "error",
			lastError: {
				phase,
				message,
				...(stack ? { stack } : {}),
				pluginPath: entry.pluginPath,
				timestamp: Date.now(),
				...(sessionId ? { sessionId } : {}),
			},
		};
	}

	/**
	 * Records discovery failures and settings-disabled plugins. Settings-
	 * disabled plugins the session would otherwise use are reported as issues
	 * with `reason: "settings"`. Returns the entries that failed discovery.
	 */
	private recordDiscovery(
		input: Pick<
			PluginSessionLoadInput,
			"disabledPluginPaths" | "discoveryFailures" | "policy" | "sessionId"
		>,
		issues: SessionPluginIssue[],
	): PluginEntry[] {
		const failed: PluginEntry[] = [];
		for (const { pluginPath, error } of input.discoveryFailures ?? []) {
			const entry = this.ensureEntry(pluginPath);
			this.recordFailure(entry, "discover", error, {
				fatal: true,
				sessionId: input.sessionId,
			});
			failed.push(entry);
			issues.push(this.toIssue(entry, "error"));
		}
		for (const pluginPath of input.disabledPluginPaths ?? []) {
			const entry = this.ensureEntry(pluginPath);
			if (entry.state !== "disabled") {
				entry.extension = undefined;
				this.setState(entry, "disabled");
			}
			if (this.isEnabledForSession(entry, input)) {
				issues.push(this.toIssue(entry, "settings"));
			}
		}
		return failed;
	}

	private isEnabledForSession(
		entry: PluginEntry,
		input: Pick<PluginSessionLoadInput, "policy">,
	): boolean {
		return isPluginEnabledByPolicy(input.policy, [
			entry.name,
			derivePluginName(entry.pluginPath, entry.pluginRoot),
		]);
	}

	private policyIssue(entry: PluginEntry): SessionPluginIssue {
		return {
			name: entry.name,
			pluginPath: entry.pluginPath,
			state: "disabled",
			reason: "session_policy",
		};
	}

	private resolveTimeouts(input: PluginSessionLoadInput): PluginTimeouts {
		return {
			import: input.importTimeoutMs ?? this.defaults.import,
			setup: this.defaults.setup,
			hook: input.hookTimeoutMs ?? this.defaults.hook,
			call: input.callTimeoutMs ?? this.defaults.call,
		};
	}

	private match(nameOrPath: string): PluginEntry[] {
		const target = nameOrPath.trim();
		if (!target) return [];
		const absolute = resolve(target);
		return [...this.entries.values()].filter(
			(entry) =>
				entry.pluginPath === absolute ||
				entry.name === target ||
				derivePluginName(entry.pluginPath, entry.pluginRoot) === target,
		);
	}

	private ensureEntry(pluginPath: string): PluginEntry {
		const absolute = resolve(pluginPath);
		let entry = this.entries.get(absolute);
		if (!entry) {
			const pluginRoot = resolvePluginRoot(absolute);
			entry = {
				pluginPath: absolute,
				pluginRoot,
				name: derivePluginName(absolute, pluginRoot),
				state: "loading",
				blocked: false,
				consecutiveFailures: 0,
				importId: 0,
				errorCount: 0,
				timeoutCount: 0,
				sessions: new Map(),
				updatedAt: Date.now(),
			};
			this.entries.set(absolute, entry);
		}
		return entry;
	}

	private wrapForSession(
		entry: PluginEntry,
		instance: PluginInstance,
		input: PluginSessionLoadInput,
		timeouts: PluginTimeouts,
	): AgentExtension {
		const extension = instance.extension;
		const emitEvent = input.emitEvent
			? (name: string, payload?: unknown) =>
					input.emitEvent?.({ name, payload })
			: undefined;
		instance.emitEvent = emitEvent;
		const originalSetup = extension.setup;
		const wrapped: AgentExtension & { __clinePluginPath?: string } = {
			...extension,
			__clinePluginPath: entry.pluginPath,
			hooks: this.wrapHooks(entry, instance, extension.hooks, input, timeouts),
			setup: originalSetup
				? async (api, ctx) => {
						if (!this.isUsable(entry, instance)) return;
						const sessionContext = {
							...(input.setupContext?.session ?? {}),
							...(ctx.session ?? {}),
						};
						const setupContext: PluginSetupContext = {
							...(input.setupContext ?? {}),
							...ctx,
							session:
								Object.keys(sessionContext).length > 0
									? sessionContext
									: undefined,
							cwd: input.cwd ?? ctx.cwd,
							emitEvent,
							onDispose: (cleanup) => {
								if (typeof cleanup === "function") {
									instance.disposers.push(cleanup);
								}
							},
						};
						await this.runSetup(
							entry,
							instance,
							(bufferedApi) =>
								originalSetup.call(extension, bufferedApi, setupContext),
							api,
							input,
							timeouts,
						);
					}
				: undefined,
		};
		return wrapped;
	}

	private async runSetup(
		entry: PluginEntry,
		instance: PluginInstance,
		invoke: (api: SetupApi) => void | Promise<void>,
		api: SetupApi,
		input: PluginSessionLoadInput,
		timeouts: PluginTimeouts,
	): Promise<void> {
		const pending = {
			tools: [] as AgentTool[],
			commands: [] as AgentExtensionCommand[],
			calls: [] as Array<(target: SetupApi) => void>,
		};
		const capabilities = new Set<string>(
			instance.extension.manifest.capabilities,
		);
		const requireCapability = (capability: string, method: string) => {
			if (!capabilities.has(capability)) {
				throw new Error(`${method} requires the "${capability}" capability`);
			}
		};
		// Buffer registrations so a setup that throws halfway contributes
		// nothing, instead of leaving the session with half a plugin.
		const bufferedApi: SetupApi = {
			registerTool: (tool) => {
				pending.tools.push(tool);
			},
			registerCommand: (command) => {
				pending.commands.push(command);
			},
			registerRule: (rule) => {
				requireCapability("rules", "registerRule");
				const wrappedRule = this.wrapRule(
					entry,
					instance,
					rule,
					input,
					timeouts,
				);
				pending.calls.push((target) => target.registerRule(wrappedRule));
			},
			registerMessageBuilder: (builder) => {
				const wrappedBuilder = this.wrapMessageBuilder(
					entry,
					instance,
					builder,
					input,
					timeouts,
				);
				pending.calls.push((target) =>
					target.registerMessageBuilder(wrappedBuilder),
				);
			},
			registerProvider: (provider) => {
				pending.calls.push((target) => target.registerProvider(provider));
			},
			registerAutomationEventType: (eventType) => {
				requireCapability("automationEvents", "registerAutomationEventType");
				pending.calls.push((target) =>
					target.registerAutomationEventType(eventType),
				);
			},
			registerMcpServer: (server) => {
				requireCapability("mcp", "registerMcpServer");
				pending.calls.push((target) => target.registerMcpServer(server));
			},
		};
		const failSetup = (error: unknown) => {
			// Setup failure only costs this session its copy of the plugin;
			// other sessions keep theirs, and the next session tries again.
			instance.setupFailed = true;
			this.recordFailure(entry, "setup", error, {
				instance,
				sessionId: input.sessionId,
				state: "failed",
				notify: input.onIssue,
			});
		};
		const startedAt = Date.now();
		try {
			await runWithTimeout(
				() => invoke(bufferedApi),
				timeouts.setup,
				`Plugin "${entry.name}" setup`,
			);
		} catch (error) {
			failSetup(error);
			return;
		}
		this.warnIfSlow(entry, "setup", startedAt, timeouts.setup, input);
		try {
			for (const tool of pending.tools) {
				api.registerTool(this.wrapTool(entry, instance, tool, input, timeouts));
			}
			for (const command of pending.commands) {
				api.registerCommand(
					this.wrapCommand(entry, instance, command, input, timeouts),
				);
			}
			for (const call of pending.calls) {
				call(api);
			}
		} catch (error) {
			// The host rejected a registration. Rethrow so the contribution
			// registry discards what this plugin already committed.
			failSetup(error);
			throw error;
		}
		if (
			instance.importId === entry.importId &&
			!entry.blocked &&
			entry.state === "failed"
		) {
			this.setState(entry, "ready");
		}
	}

	private wrapHooks(
		entry: PluginEntry,
		instance: PluginInstance,
		hooks: ExtensionHooks | undefined,
		input: PluginSessionLoadInput,
		timeouts: PluginTimeouts,
	): ExtensionHooks | undefined {
		if (!hooks) return undefined;
		const wrapped: Record<string, HookFn> = {};
		for (const [hookName, hook] of Object.entries(hooks)) {
			if (typeof hook !== "function") continue;
			const phase: PluginErrorPhase = `hook:${hookName}`;
			wrapped[hookName] = async (...args: unknown[]) => {
				if (!this.isUsable(entry, instance)) return undefined;
				try {
					return await this.guardedCall(
						entry,
						instance,
						phase,
						timeouts.hook,
						input,
						() => (hook as HookFn).apply(hooks, args),
					);
				} catch (error) {
					if (input.hookErrorMode === "throw") throw error;
					return undefined;
				}
			};
		}
		return wrapped as ExtensionHooks;
	}

	private wrapTool(
		entry: PluginEntry,
		instance: PluginInstance,
		tool: AgentTool,
		input: PluginSessionLoadInput,
		timeouts: PluginTimeouts,
	): AgentTool {
		const phase: PluginErrorPhase = `tool:${tool.name}`;
		return {
			...tool,
			execute: async (toolInput: unknown, context: AgentToolContext) => {
				this.assertUsable(entry, instance, `tool "${tool.name}"`);
				return this.guardedCall(
					entry,
					instance,
					phase,
					tool.timeoutMs ?? timeouts.call,
					input,
					() =>
						tool.execute(toolInput, {
							...context,
							cwd: context.cwd ?? input.cwd,
							emitEvent: context.emitEvent ?? instance.emitEvent,
						}),
					// A cancelled run is not the plugin's fault.
					() => context.signal?.aborted === true,
				);
			},
		};
	}

	private wrapCommand(
		entry: PluginEntry,
		instance: PluginInstance,
		command: AgentExtensionCommand,
		input: PluginSessionLoadInput,
		timeouts: PluginTimeouts,
	): AgentExtensionCommand {
		const handler = command.handler;
		if (typeof handler !== "function") return command;
		const wrapped: AgentExtensionCommand = {
			...command,
			handler: async (commandInput: string) => {
				this.assertUsable(entry, instance, `command "/${command.name}"`);
				return this.guardedCall(
					entry,
					instance,
					`command:${command.name}`,
					timeouts.call,
					input,
					() => handler.call(command, commandInput),
				);
			},
		};
		return markPluginCommand(wrapped);
	}

	/** A failing rule contributes no text rather than breaking the prompt. */
	private wrapRule(
		entry: PluginEntry,
		instance: PluginInstance,
		rule: AgentExtensionRule,
		input: PluginSessionLoadInput,
		timeouts: PluginTimeouts,
	): AgentExtensionRule {
		const content = rule.content;
		if (typeof content !== "function") return rule;
		return {
			...rule,
			content: async () => {
				if (!this.isUsable(entry, instance)) return "";
				try {
					return await this.guardedCall(
						entry,
						instance,
						`rule:${rule.id}`,
						timeouts.call,
						input,
						() => content.call(rule),
					);
				} catch {
					return "";
				}
			},
		};
	}

	/** A failing builder leaves the message unchanged. */
	private wrapMessageBuilder(
		entry: PluginEntry,
		instance: PluginInstance,
		builder: AgentExtensionMessageBuilder<Message[]>,
		input: PluginSessionLoadInput,
		timeouts: PluginTimeouts,
	): AgentExtensionMessageBuilder<Message[]> {
		return {
			...builder,
			build: async (messages) => {
				if (!this.isUsable(entry, instance)) return messages;
				try {
					return await this.guardedCall(
						entry,
						instance,
						`messageBuilder:${builder.name}`,
						timeouts.call,
						input,
						() => builder.build.call(builder, messages),
					);
				} catch {
					return messages;
				}
			},
		};
	}

	/**
	 * Runs one plugin call with a timeout, records the outcome against the
	 * plugin, and rethrows failures.
	 */
	private async guardedCall<T>(
		entry: PluginEntry,
		instance: PluginInstance,
		phase: PluginErrorPhase,
		timeoutMs: number,
		input: PluginSessionLoadInput,
		call: () => T | Promise<T>,
		isCancelled?: () => boolean,
	): Promise<T> {
		const startedAt = Date.now();
		try {
			const result = await runWithTimeout(
				call,
				timeoutMs,
				`Plugin "${entry.name}" ${phase}`,
			);
			if (instance.importId === entry.importId) entry.consecutiveFailures = 0;
			this.warnIfSlow(entry, phase, startedAt, timeoutMs, input);
			return result;
		} catch (error) {
			if (!isCancelled?.()) {
				this.recordFailure(entry, phase, error, {
					instance,
					sessionId: input.sessionId,
				});
			}
			throw error;
		}
	}

	/**
	 * Whether a session's copy may still be called: the plugin is not turned
	 * off, its setup did not fail, and its session has not ended.
	 */
	private isUsable(entry: PluginEntry, instance: PluginInstance): boolean {
		return !entry.blocked && !instance.setupFailed && !instance.closed;
	}

	private assertUsable(
		entry: PluginEntry,
		instance: PluginInstance,
		what: string,
	): void {
		if (this.isUsable(entry, instance)) return;
		const reason = instance.closed
			? "its session ended"
			: entry.lastError
				? `${entry.lastError.phase}: ${entry.lastError.message}`
				: "it is turned off";
		throw new Error(
			`Plugin "${entry.name}" ${what} is unavailable (${reason})`,
		);
	}

	private async releaseInstance(
		entry: PluginEntry,
		instance: PluginInstance,
		sessionId: string | undefined,
		timeouts: PluginTimeouts,
	): Promise<void> {
		if (instance.closed) return;
		instance.closed = true;
		if (sessionId) entry.sessions.delete(sessionId);
		for (const cleanup of instance.disposers.splice(0).reverse()) {
			try {
				await runWithTimeout(
					cleanup,
					timeouts.hook,
					`Plugin "${entry.name}" dispose`,
				);
			} catch (error) {
				// Log only: a cleanup failure must not change the status that
				// other sessions rely on.
				const { message, stack } = toErrorParts(error);
				this.log("warn", "plugin.error", entry, {
					phase: "dispose",
					sessionId,
					errorMessage: message,
					stack,
				});
			}
		}
		// Ending the worker stops everything the copy started (timers,
		// sockets, pending work).
		await instance.shutdown?.().catch(() => {
			// Best-effort: the worker may already be gone.
		});
	}

	private recordFailure(
		entry: PluginEntry,
		phase: PluginErrorPhase,
		error: unknown,
		options: {
			/** Turn the plugin off for every session. */
			fatal?: boolean;
			/** Force this state without blocking (per-session setup failure). */
			state?: PluginRuntimeState;
			sessionId?: string;
			messagePrefix?: string;
			/** Tell the calling session even if the state did not change. */
			notify?: (issue: SessionPluginIssue) => void;
			/** The copy the failure came from, when it came from one. */
			instance?: PluginInstance;
		},
	): void {
		const { message, stack } = toErrorParts(error);
		const timedOut = error instanceof PluginCallTimeoutError;
		const stale =
			options.instance !== undefined &&
			options.instance.importId !== entry.importId;
		this.log("warn", "plugin.error", entry, {
			phase,
			sessionId: options.sessionId,
			errorMessage: message,
			timedOut,
			stale,
			stack,
		});
		const record: PluginErrorRecord = {
			phase,
			message: `${options.messagePrefix ?? ""}${message}`,
			...(stack ? { stack } : {}),
			pluginPath: entry.pluginPath,
			timestamp: Date.now(),
			...(options.sessionId ? { sessionId: options.sessionId } : {}),
			...(timedOut ? { timedOut } : {}),
		};
		if (stale) {
			// A copy from before a reload says nothing about the current module:
			// tell its own session, but leave the status and counts alone.
			const onIssue =
				options.notify ??
				(options.sessionId ? entry.sessions.get(options.sessionId) : undefined);
			try {
				onIssue?.({
					name: entry.name,
					pluginPath: entry.pluginPath,
					state: options.state ?? "degraded",
					reason: "error",
					lastError: record,
				});
			} catch {
				// Reporting must never turn into a second failure.
			}
			return;
		}
		entry.errorCount += 1;
		if (timedOut) entry.timeoutCount += 1;
		entry.consecutiveFailures += 1;
		entry.lastError = record;
		const block =
			options.fatal === true ||
			(!options.state && entry.consecutiveFailures >= this.failureThreshold);
		const next: PluginRuntimeState = block
			? "failed"
			: (options.state ?? "degraded");
		// Sessions are told when the plugin is turned off even if the state
		// already read `failed` from a per-session setup failure.
		const changed = entry.state !== next || (block && !entry.blocked);
		if (block) {
			entry.blocked = true;
			entry.extension = undefined;
		}
		this.setState(entry, next, true);
		const issue = this.toIssue(entry, "error");
		// A per-session failure (setup) concerns only the calling session;
		// other sessions' copies still work, so do not tell them otherwise.
		const notified: Array<(issue: SessionPluginIssue) => void> = [];
		if (changed && !options.state) {
			for (const onIssue of entry.sessions.values()) {
				if (onIssue) notified.push(onIssue);
			}
		}
		if (options.notify && !notified.includes(options.notify)) {
			notified.push(options.notify);
		}
		for (const onIssue of notified) {
			try {
				onIssue(issue);
			} catch {
				// Reporting must never turn into a second failure.
			}
		}
	}

	private setState(
		entry: PluginEntry,
		state: PluginRuntimeState,
		forceNotify = false,
	): void {
		const changed = entry.state !== state;
		entry.state = state;
		entry.updatedAt = Date.now();
		if (!changed && !forceNotify) return;
		const status = this.toStatus(entry);
		for (const listener of this.listeners) {
			try {
				listener(status);
			} catch {
				// A broken listener must not break plugin status tracking.
			}
		}
	}

	private warnIfSlow(
		entry: PluginEntry,
		phase: string,
		startedAt: number,
		limitMs: number,
		input: PluginSessionLoadInput,
	): void {
		// A synchronous plugin call blocks the event loop, so its timeout can
		// only be observed after it returns. Log it once it does.
		const elapsedMs = Date.now() - startedAt;
		if (elapsedMs <= limitMs) return;
		this.log("warn", "plugin.call.slow", entry, {
			phase,
			sessionId: input.sessionId,
			elapsedMs,
			limitMs,
		});
	}

	private log(
		level: "info" | "warn",
		event: string,
		entry: PluginEntry,
		fields: Record<string, unknown>,
	): void {
		const metadata = {
			event,
			pluginName: entry.name,
			pluginPath: entry.pluginPath,
			state: entry.state,
			...fields,
		};
		if (level === "info") {
			this.logger?.debug?.(`[plugins] ${event} ${entry.name}`, metadata);
			return;
		}
		const detail = typeof fields.phase === "string" ? ` (${fields.phase})` : "";
		const message =
			typeof fields.errorMessage === "string" ? `: ${fields.errorMessage}` : "";
		this.logger?.log(`[plugins] ${event} ${entry.name}${detail}${message}`, {
			severity: "warn",
			...metadata,
		});
	}

	private toStatus(entry: PluginEntry): PluginStatusRecord {
		return {
			name: entry.name,
			pluginPath: entry.pluginPath,
			state: entry.state,
			...(entry.lastError ? { lastError: { ...entry.lastError } } : {}),
			errorCount: entry.errorCount,
			timeoutCount: entry.timeoutCount,
			sessionIds: [...entry.sessions.keys()].sort(),
			...(entry.extension
				? {
						capabilities: [...entry.extension.manifest.capabilities].sort(),
						hooks: Object.keys(entry.extension.hooks ?? {}).sort(),
					}
				: {}),
			updatedAt: entry.updatedAt,
		};
	}

	private toIssue(
		entry: PluginEntry,
		reason: SessionPluginIssue["reason"],
	): SessionPluginIssue {
		return {
			name: entry.name,
			pluginPath: entry.pluginPath,
			state: entry.state,
			reason,
			...(entry.lastError ? { lastError: { ...entry.lastError } } : {}),
		};
	}

	private toInitializationFailure(
		entry: PluginEntry,
	): PluginInitializationFailure {
		return {
			pluginPath: entry.pluginPath,
			pluginName: entry.name,
			phase: entry.lastError?.phase === "setup" ? "setup" : "load",
			message: entry.lastError?.message ?? `Plugin is ${entry.state}`,
			stack: entry.lastError?.stack,
		};
	}
}

/** One-line, user-facing description of a plugin a session cannot fully use. */
export function formatSessionPluginIssue(issue: SessionPluginIssue): string {
	const phase = issue.lastError?.phase;
	const message = issue.lastError?.message ?? "unknown error";
	if (issue.state === "degraded") {
		return `Plugin "${issue.name}" ${phase ?? "call"} failed: ${message}. The plugin is still active; repeated failures will turn it off.`;
	}
	if (issue.state === "disabled") {
		return `Plugin "${issue.name}" is disabled${issue.reason === "session_policy" ? " for this session" : " in settings"}.`;
	}
	const where =
		phase === "uncaught"
			? " with an uncaught error"
			: phase
				? ` during ${phase}`
				: "";
	return `Plugin "${issue.name}" failed${where}: ${message} (${issue.pluginPath}). Its tools and hooks are unavailable.`;
}

let processPluginRegistry: PluginRegistry | undefined;

/**
 * The registry shared by every session in this process. The Hub daemon reads
 * it for `plugins.*` requests and to attribute stray plugin errors.
 */
export function getProcessPluginRegistry(): PluginRegistry {
	processPluginRegistry ??= new PluginRegistry();
	return processPluginRegistry;
}

/** @internal Test hook. */
export function resetProcessPluginRegistryForTests(
	registry?: PluginRegistry,
): void {
	processPluginRegistry = registry;
}
