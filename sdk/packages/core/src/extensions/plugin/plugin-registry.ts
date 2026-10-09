import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type {
	AgentExtension,
	AgentExtensionApi,
	AgentExtensionCommand,
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
import type {
	PluginInitializationFailure,
	PluginInitializationWarning,
} from "./plugin-load-report";
import { loadAgentPluginFromPath } from "./plugin-loader";
import {
	matchesPluginManifestTargeting,
	type PluginTargeting,
} from "./plugin-targeting";

export const DEFAULT_PLUGIN_IMPORT_TIMEOUT_MS = 4_000;
export const DEFAULT_PLUGIN_SETUP_TIMEOUT_MS = 4_000;
export const DEFAULT_PLUGIN_HOOK_TIMEOUT_MS = 3_000;
export const DEFAULT_PLUGIN_TOOL_TIMEOUT_MS = 60_000;
/** Consecutive hook/tool failures after which a degraded plugin is `failed`. */
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
	/** Directory (package plugins) or file path used to attribute stack frames. */
	attributionRoot: string;
	name: string;
	state: PluginRuntimeState;
	/**
	 * Set when the plugin is turned off for every session: import or discovery
	 * failed, a stray error was attributed to it, or calls kept failing. A
	 * `setup()` failure alone is per session and does not set this.
	 */
	blocked: boolean;
	/** The imported module, read for metadata (name, manifest, hooks). */
	extension?: AgentExtension;
	/**
	 * An imported copy no session has used yet. The first session claims it;
	 * later sessions import their own copy so module state is per session.
	 */
	spare?: AgentExtension;
	/** Bumped on every (re)import; wrappers from older generations stop recording. */
	generation: number;
	fingerprint?: string;
	lastError?: PluginErrorRecord;
	errorCount: number;
	timeoutCount: number;
	consecutiveFailures: number;
	sessions: Set<string>;
	/** Per-session `onIssue` callbacks, notified on degraded/failed. */
	issueListeners: Map<string, (issue: SessionPluginIssue) => void>;
	loading?: Promise<void>;
	updatedAt: number;
}

/** One session's copy of a plugin module. */
interface PluginInstance {
	extension: AgentExtension;
	setupFailed: boolean;
}

interface PluginCallScope {
	sessionId?: string;
	pluginName: string;
	emitEvent?: (name: string, payload?: unknown) => void;
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
}

export interface PluginSessionLoadResult {
	extensions: AgentExtension[];
	pluginPaths: string[];
	failures: PluginInitializationFailure[];
	warnings: PluginInitializationWarning[];
	issues: SessionPluginIssue[];
	/** Detaches the session from the registry's session tracking. */
	release: () => void;
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

function fingerprintOf(pluginPath: string): string {
	try {
		const stats = statSync(pluginPath);
		return `${stats.mtimeMs}:${stats.size}`;
	} catch {
		return "missing";
	}
}

/**
 * Package plugins own their whole package directory; a single-file plugin
 * in a shared `plugins/` folder owns only its file, so a stray error from one
 * drop-in file is never blamed on its neighbours.
 */
function resolveAttributionRoot(pluginPath: string): string {
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
function derivePluginName(pluginPath: string, attributionRoot: string): string {
	return attributionRoot === pluginPath
		? basename(pluginPath, extname(pluginPath))
		: getPluginDisplayName(pluginPath, attributionRoot);
}

function stackMentionsPath(stack: string, root: string): boolean {
	const candidates = [root, pathToFileURL(root).href];
	return candidates.some((candidate) => {
		let index = stack.indexOf(candidate);
		while (index !== -1) {
			const next = stack[index + candidate.length];
			// Require a boundary so /plugins/foo does not match /plugins/foobar.
			if (
				next === undefined ||
				next === sep ||
				next === "/" ||
				next === ":" ||
				next === ")" ||
				next === "?" ||
				/\s/.test(next)
			) {
				return true;
			}
			index = stack.indexOf(candidate, index + 1);
		}
		return false;
	});
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

const pluginCallScope = new AsyncLocalStorage<PluginCallScope>();
let lastPluginCallScope: PluginCallScope | undefined;

function runInPluginScope<T>(scope: PluginCallScope, fn: () => T): T {
	lastPluginCallScope = scope;
	return pluginCallScope.run(scope, fn);
}

/**
 * Plugins written for the subprocess sandbox emit events through
 * `globalThis.__clinePluginHost.emitEvent`. In-process, route those calls to
 * the session whose hook or tool is running (async context follows timers and
 * promises the call started), else to the session that last called a plugin.
 */
export function installPluginHostShim(): void {
	const globals = globalThis as Record<string, unknown>;
	if (globals.__clinePluginHost) return;
	globals.__clinePluginHost = {
		emitEvent: (name: string, payload?: unknown) => {
			const scope = pluginCallScope.getStore() ?? lastPluginCallScope;
			scope?.emitEvent?.(name, payload);
		},
	};
}

/**
 * Tracks plugins for the whole process and hands each session a guarded copy
 * of the plugins it enabled. Each session gets its own import of the module,
 * matching the per-session sandbox plugins were written for. Every import,
 * setup, hook, tool, and command call is wrapped with a timeout and error
 * capture, and the result is recorded per plugin so failures are visible
 * instead of silently dropping the plugin's tools.
 */
export class PluginRegistry {
	private readonly entries = new Map<string, PluginEntry>();
	private readonly listeners = new Set<PluginStatusListener>();
	private logger: BasicLogger | undefined;
	private readonly importTimeoutMs: number;
	private readonly setupTimeoutMs: number;
	private readonly hookTimeoutMs: number;
	private readonly toolTimeoutMs: number;
	private readonly failureThreshold: number;

	constructor(options: PluginRegistryOptions = {}) {
		this.logger = options.logger;
		this.importTimeoutMs =
			options.importTimeoutMs ??
			readTimeoutEnv(PLUGIN_IMPORT_TIMEOUT_ENV) ??
			DEFAULT_PLUGIN_IMPORT_TIMEOUT_MS;
		this.setupTimeoutMs =
			options.setupTimeoutMs ?? DEFAULT_PLUGIN_SETUP_TIMEOUT_MS;
		this.hookTimeoutMs =
			options.hookTimeoutMs ?? DEFAULT_PLUGIN_HOOK_TIMEOUT_MS;
		this.toolTimeoutMs =
			options.toolTimeoutMs ?? DEFAULT_PLUGIN_TOOL_TIMEOUT_MS;
		this.failureThreshold =
			options.failureThreshold ?? DEFAULT_PLUGIN_FAILURE_THRESHOLD;
		installPluginHostShim();
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
	 * Re-imports the matching plugins and resets their error counters.
	 * Sessions started afterwards use the new module; running sessions keep
	 * the instance they were set up with.
	 */
	async reload(nameOrPath: string): Promise<PluginStatusRecord[]> {
		const matches = this.match(nameOrPath);
		for (const entry of matches) {
			entry.fingerprint = undefined;
			entry.blocked = false;
			entry.lastError = undefined;
			entry.errorCount = 0;
			entry.timeoutCount = 0;
			entry.consecutiveFailures = 0;
			this.log("info", "plugin.reload", entry, {});
			await this.ensureLoaded(entry.pluginPath, { force: true });
		}
		return matches.map((entry) => this.toStatus(entry));
	}

	/**
	 * Finds the plugin whose module root appears in `error`'s stack, marks it
	 * `failed`, and returns its status. Used by the Hub daemon so a stray
	 * plugin exception or rejection does not take the process down.
	 */
	attributeUncaughtError(
		error: unknown,
		label = "uncaught",
	): PluginStatusRecord | undefined {
		const stack = error instanceof Error ? error.stack : undefined;
		if (!stack) return undefined;
		// Prefer the most specific root when roots nest.
		const entry = [...this.entries.values()]
			.filter((candidate) =>
				stackMentionsPath(stack, candidate.attributionRoot),
			)
			.sort(
				(left, right) =>
					right.attributionRoot.length - left.attributionRoot.length,
			)[0];
		if (!entry) return undefined;
		this.recordFailure(entry, entry.generation, "uncaught", error, {
			fatal: true,
			messagePrefix: `${label}: `,
		});
		return this.toStatus(entry);
	}

	/**
	 * Imports plugins without attaching them to a session, so the Hub can
	 * discover and load them at startup and report status before any session
	 * exists.
	 */
	async preload(
		input: Pick<
			PluginSessionLoadInput,
			"pluginPaths" | "disabledPluginPaths" | "discoveryFailures" | "exportName"
		>,
	): Promise<PluginStatusRecord[]> {
		const loaded = await this.loadForSession(input);
		loaded.release();
		return this.list();
	}

	async loadForSession(
		input: PluginSessionLoadInput,
	): Promise<PluginSessionLoadResult> {
		const failures: PluginInitializationFailure[] = [];
		const warnings: PluginInitializationWarning[] = [];
		const issues: SessionPluginIssue[] = [];
		const sessionId = input.sessionId;

		for (const { pluginPath, error } of input.discoveryFailures ?? []) {
			const entry = this.ensureEntry(pluginPath);
			this.recordFailure(entry, entry.generation, "discover", error, {
				fatal: true,
				sessionId,
			});
			failures.push(this.toInitializationFailure(entry));
			issues.push(this.toIssue(entry, "error"));
		}
		for (const pluginPath of input.disabledPluginPaths ?? []) {
			const entry = this.ensureEntry(pluginPath);
			if (entry.state !== "disabled") {
				entry.extension = undefined;
				entry.spare = undefined;
				this.setState(entry, "disabled");
			}
		}

		const loadedByName = new Map<
			string,
			{ entry: PluginEntry; order: number }
		>();
		let order = 0;
		for (const rawPath of input.pluginPaths) {
			const pluginPath = resolve(rawPath);
			const entry = await this.ensureLoaded(pluginPath, {
				exportName: input.exportName,
			});
			const names = [
				entry.name,
				derivePluginName(pluginPath, entry.attributionRoot),
			];
			const enabledByPolicy = isPluginEnabledByPolicy(input.policy, names);
			if (entry.blocked || entry.state === "disabled" || !entry.extension) {
				// A broken plugin the session turned off is not this session's
				// problem; report it as disabled rather than as a failure.
				if (!enabledByPolicy) {
					issues.push({
						name: entry.name,
						pluginPath,
						state: "disabled",
						reason: "session_policy",
					});
					continue;
				}
				if (entry.state === "failed") {
					failures.push(this.toInitializationFailure(entry));
				}
				issues.push(
					this.toIssue(
						entry,
						entry.state === "disabled" ? "settings" : "error",
					),
				);
				continue;
			}
			if (!matchesPluginManifestTargeting(entry.extension.manifest, input)) {
				continue;
			}
			if (!enabledByPolicy) {
				issues.push({
					name: entry.name,
					pluginPath,
					state: "disabled",
					reason: "session_policy",
				});
				continue;
			}
			const existing = loadedByName.get(entry.name);
			if (existing) {
				warnings.push({
					type: "duplicate_plugin_override",
					pluginName: entry.name,
					pluginPath,
					overriddenPluginPath: existing.entry.pluginPath,
					message: `Plugin "${entry.name}" from ${pluginPath} overrides ${existing.entry.pluginPath}`,
				});
			}
			loadedByName.set(entry.name, { entry, order: order++ });
		}

		const ordered = [...loadedByName.values()].sort(
			(left, right) => left.order - right.order,
		);
		const selected: Array<{ entry: PluginEntry; instance: PluginInstance }> =
			[];
		for (const { entry } of ordered) {
			const generation = entry.generation;
			try {
				const extension = await this.claimInstance(entry, input.exportName);
				selected.push({ entry, instance: { extension, setupFailed: false } });
			} catch (error) {
				this.recordFailure(entry, generation, "import", error, {
					fatal: true,
					sessionId,
				});
				failures.push(this.toInitializationFailure(entry));
				issues.push(this.toIssue(entry, "error"));
			}
		}
		if (sessionId) {
			for (const { entry } of selected) {
				entry.sessions.add(sessionId);
				if (input.onIssue) entry.issueListeners.set(sessionId, input.onIssue);
			}
		}
		const extensions = selected.map(({ entry, instance }) =>
			this.wrapForSession(entry, instance, input),
		);
		let released = false;
		return {
			extensions,
			pluginPaths: selected.map(({ entry }) => entry.pluginPath),
			failures,
			warnings,
			issues,
			release: () => {
				if (released || !sessionId) return;
				released = true;
				for (const { entry } of selected) {
					entry.sessions.delete(sessionId);
					entry.issueListeners.delete(sessionId);
				}
			},
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
				derivePluginName(entry.pluginPath, entry.attributionRoot) === target,
		);
	}

	private ensureEntry(pluginPath: string): PluginEntry {
		const absolute = resolve(pluginPath);
		let entry = this.entries.get(absolute);
		if (!entry) {
			const attributionRoot = resolveAttributionRoot(absolute);
			entry = {
				pluginPath: absolute,
				attributionRoot,
				name: derivePluginName(absolute, attributionRoot),
				state: "loading",
				blocked: false,
				generation: 0,
				errorCount: 0,
				timeoutCount: 0,
				consecutiveFailures: 0,
				sessions: new Set(),
				issueListeners: new Map(),
				updatedAt: Date.now(),
			};
			this.entries.set(absolute, entry);
		}
		return entry;
	}

	private async ensureLoaded(
		pluginPath: string,
		options: { force?: boolean; exportName?: string },
	): Promise<PluginEntry> {
		const entry = this.ensureEntry(pluginPath);
		if (entry.loading) {
			await entry.loading;
			return entry;
		}
		const fingerprint = fingerprintOf(entry.pluginPath);
		const upToDate =
			!options.force &&
			entry.fingerprint === fingerprint &&
			entry.state !== "disabled" &&
			entry.state !== "loading";
		if (upToDate) return entry;

		entry.loading = this.importEntry(entry, fingerprint, options.exportName);
		try {
			await entry.loading;
		} finally {
			entry.loading = undefined;
		}
		return entry;
	}

	/**
	 * Hands a session its own copy of the plugin module. Plugins written for
	 * the per-session sandbox keep state at module level (one plugin object
	 * per import), so sharing one copy across sessions would break them.
	 */
	private async claimInstance(
		entry: PluginEntry,
		exportName: string | undefined,
	): Promise<AgentExtension> {
		const spare = entry.spare;
		if (spare) {
			entry.spare = undefined;
			return spare;
		}
		return runWithTimeout(
			() =>
				loadAgentPluginFromPath(entry.pluginPath, {
					exportName,
					freshModule: true,
				}),
			this.importTimeoutMs,
			`Plugin import of ${entry.pluginPath}`,
		);
	}

	private async importEntry(
		entry: PluginEntry,
		fingerprint: string,
		exportName: string | undefined,
	): Promise<void> {
		entry.generation += 1;
		const generation = entry.generation;
		entry.fingerprint = fingerprint;
		entry.extension = undefined;
		entry.spare = undefined;
		entry.blocked = false;
		entry.consecutiveFailures = 0;
		this.setState(entry, "loading", true);
		const startedAt = Date.now();
		try {
			const extension = await runWithTimeout(
				() =>
					loadAgentPluginFromPath(entry.pluginPath, {
						exportName,
						freshModule: true,
					}),
				this.importTimeoutMs,
				`Plugin import of ${entry.pluginPath}`,
			);
			if (generation !== entry.generation) return;
			entry.extension = extension;
			entry.spare = extension;
			entry.name = extension.name;
			this.setState(entry, "ready");
			this.log("info", "plugin.import.ready", entry, {
				elapsedMs: Date.now() - startedAt,
			});
		} catch (error) {
			if (generation !== entry.generation) return;
			this.recordFailure(entry, generation, "import", error, { fatal: true });
		}
	}

	private wrapForSession(
		entry: PluginEntry,
		instance: PluginInstance,
		input: PluginSessionLoadInput,
	): AgentExtension {
		const extension = instance.extension;
		const generation = entry.generation;
		const sessionId = input.sessionId;
		const emitEvent = input.emitEvent
			? (name: string, payload?: unknown) =>
					input.emitEvent?.({ name, payload })
			: undefined;
		const scope: PluginCallScope = {
			sessionId,
			pluginName: entry.name,
			emitEvent,
		};
		const originalSetup = extension.setup;
		const wrapped: AgentExtension & { __clinePluginPath?: string } = {
			...extension,
			__clinePluginPath: entry.pluginPath,
			hooks: this.wrapHooks(
				entry,
				generation,
				instance,
				extension.hooks,
				scope,
				input,
			),
			setup: originalSetup
				? async (api, ctx) => {
						if (entry.blocked) return;
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
						};
						await this.runSetup(
							entry,
							generation,
							instance,
							(bufferedApi) => originalSetup(bufferedApi, setupContext),
							api,
							scope,
							input,
						);
					}
				: undefined,
		};
		return wrapped;
	}

	private async runSetup(
		entry: PluginEntry,
		generation: number,
		instance: PluginInstance,
		invoke: (api: SetupApi) => void | Promise<void>,
		api: SetupApi,
		scope: PluginCallScope,
		input: PluginSessionLoadInput,
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
				pending.calls.push((target) => target.registerRule(rule));
			},
			registerMessageBuilder: (builder) => {
				pending.calls.push((target) => target.registerMessageBuilder(builder));
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
		const startedAt = Date.now();
		try {
			await runWithTimeout(
				() => runInPluginScope(scope, () => invoke(bufferedApi)),
				this.setupTimeoutMs,
				`Plugin "${entry.name}" setup`,
			);
		} catch (error) {
			// Setup failure only costs this session its copy of the plugin;
			// other sessions keep theirs, and the next session tries again.
			instance.setupFailed = true;
			this.recordFailure(entry, generation, "setup", error, {
				sessionId: input.sessionId,
				state: "failed",
				notify: input.onIssue,
			});
			return;
		}
		if (
			generation === entry.generation &&
			!entry.blocked &&
			entry.state === "failed"
		) {
			this.setState(entry, "ready");
		}
		this.warnIfSlow(entry, "setup", startedAt, this.setupTimeoutMs, input);
		for (const tool of pending.tools) {
			api.registerTool(
				this.wrapTool(entry, generation, instance, tool, scope, input),
			);
		}
		for (const command of pending.commands) {
			api.registerCommand(
				this.wrapCommand(entry, generation, command, scope, input),
			);
		}
		for (const call of pending.calls) {
			call(api);
		}
	}

	private wrapHooks(
		entry: PluginEntry,
		generation: number,
		instance: PluginInstance,
		hooks: ExtensionHooks | undefined,
		scope: PluginCallScope,
		input: PluginSessionLoadInput,
	): ExtensionHooks | undefined {
		if (!hooks) return undefined;
		const wrapped: Record<string, HookFn> = {};
		for (const [hookName, hook] of Object.entries(hooks)) {
			if (typeof hook !== "function") continue;
			const phase: PluginErrorPhase = `hook:${hookName}`;
			wrapped[hookName] = async (...args: unknown[]) => {
				if (!this.isUsable(entry, generation, instance)) {
					return undefined;
				}
				const startedAt = Date.now();
				try {
					const result = await runWithTimeout(
						() =>
							runInPluginScope(scope, () =>
								(hook as HookFn).apply(hooks, args),
							),
						this.hookTimeoutMs,
						`Plugin "${entry.name}" ${phase}`,
					);
					this.recordSuccess(entry, generation);
					this.warnIfSlow(entry, phase, startedAt, this.hookTimeoutMs, input);
					return result;
				} catch (error) {
					this.recordFailure(entry, generation, phase, error, {
						sessionId: input.sessionId,
					});
					if (input.hookErrorMode === "throw") throw error;
					return undefined;
				}
			};
		}
		return wrapped as ExtensionHooks;
	}

	private wrapTool(
		entry: PluginEntry,
		generation: number,
		instance: PluginInstance,
		tool: AgentTool,
		scope: PluginCallScope,
		input: PluginSessionLoadInput,
	): AgentTool {
		const phase: PluginErrorPhase = `tool:${tool.name}`;
		const timeoutMs = tool.timeoutMs ?? this.toolTimeoutMs;
		return {
			...tool,
			execute: async (toolInput: unknown, context: AgentToolContext) => {
				if (!this.isUsable(entry, generation, instance)) {
					const reason = entry.lastError
						? `: ${entry.lastError.phase}: ${entry.lastError.message}`
						: "";
					throw new Error(
						`Plugin "${entry.name}" is ${entry.state}; tool "${tool.name}" is unavailable${reason}`,
					);
				}
				const startedAt = Date.now();
				try {
					const result = await runWithTimeout(
						() =>
							runInPluginScope(scope, () =>
								tool.execute(toolInput, {
									...context,
									cwd: context.cwd ?? input.cwd,
									emitEvent: context.emitEvent ?? scope.emitEvent,
								}),
							),
						timeoutMs,
						`Plugin "${entry.name}" ${phase}`,
					);
					this.recordSuccess(entry, generation);
					this.warnIfSlow(entry, phase, startedAt, timeoutMs, input);
					return result;
				} catch (error) {
					// A cancelled run is not the plugin's fault.
					if (!context.signal?.aborted) {
						this.recordFailure(entry, generation, phase, error, {
							sessionId: input.sessionId,
						});
					}
					throw error;
				}
			},
		};
	}

	private wrapCommand(
		entry: PluginEntry,
		generation: number,
		command: AgentExtensionCommand,
		scope: PluginCallScope,
		input: PluginSessionLoadInput,
	): AgentExtensionCommand {
		const handler = command.handler;
		if (typeof handler !== "function") return command;
		const phase: PluginErrorPhase = `command:${command.name}`;
		return {
			...command,
			handler: async (commandInput: string) => {
				try {
					const result = await runInPluginScope(scope, () =>
						handler(commandInput),
					);
					this.recordSuccess(entry, generation);
					return result;
				} catch (error) {
					this.recordFailure(entry, generation, phase, error, {
						sessionId: input.sessionId,
					});
					throw error;
				}
			},
		};
	}

	/**
	 * Whether a session's copy may still be called. Calls stop when the plugin
	 * is blocked for everyone, when this copy's setup failed, or when a reload
	 * replaced the module this copy came from.
	 */
	private isUsable(
		entry: PluginEntry,
		generation: number,
		instance: PluginInstance,
	): boolean {
		return (
			!entry.blocked && !instance.setupFailed && generation === entry.generation
		);
	}

	private recordSuccess(entry: PluginEntry, generation: number): void {
		if (generation === entry.generation) {
			entry.consecutiveFailures = 0;
		}
	}

	private recordFailure(
		entry: PluginEntry,
		generation: number,
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
		},
	): void {
		const { message, stack } = toErrorParts(error);
		const timedOut = error instanceof PluginCallTimeoutError;
		this.log("warn", "plugin.error", entry, {
			phase,
			sessionId: options.sessionId,
			errorMessage: message,
			timedOut,
			stack,
		});
		// A session still running an old module must not overwrite the
		// status of the reloaded one.
		if (generation !== entry.generation) return;
		entry.errorCount += 1;
		if (timedOut) entry.timeoutCount += 1;
		entry.consecutiveFailures += 1;
		entry.lastError = {
			phase,
			message: `${options.messagePrefix ?? ""}${message}`,
			...(stack ? { stack } : {}),
			pluginPath: entry.pluginPath,
			timestamp: Date.now(),
			...(options.sessionId ? { sessionId: options.sessionId } : {}),
			...(timedOut ? { timedOut } : {}),
		};
		const block =
			options.fatal === true ||
			(!options.state && entry.consecutiveFailures >= this.failureThreshold);
		const next: PluginRuntimeState = block
			? "failed"
			: (options.state ?? "degraded");
		if (block) {
			entry.blocked = true;
			entry.extension = undefined;
			entry.spare = undefined;
		}
		const changed = entry.state !== next;
		this.setState(entry, next, true);
		const issue = this.toIssue(entry, "error");
		// A per-session failure (setup) concerns only the calling session;
		// other sessions' copies still work, so do not tell them otherwise.
		const notified =
			changed && !options.state ? [...entry.issueListeners.values()] : [];
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
			sessionIds: [...entry.sessions].sort(),
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
		return `Plugin "${issue.name}" is disabled${issue.reason === "session_policy" ? " for this session" : ""}.`;
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
